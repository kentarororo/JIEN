import assert from 'node:assert/strict';
import test from 'node:test';

import { feedbackIssueBody, feedbackIssueTitle, parseFeedbackEnvelope } from './feedback-contract.ts';
import { createFeedbackGithubIssue } from './feedback-github.ts';
import { feedbackContextLines, normalizeFeedbackMessage } from '../../../src/lib/feedback-context.ts';

const context = { screen: 'Food', appVersion: '1.0.0', build: 'development', platform: 'web 0', viewport: '390×844', connection: 'offline' as const };
const data = { id: '0b5f7e9a-1c2d-4e3f-8a9b-0c1d2e3f4a5b', type: 'bug', message: 'Save does nothing after I edit the portion twice and go back', context, screenshotBase64: null, createdAt: '2026-11-05T00:00:00.000Z' };
const envelope = (overrides: Record<string, unknown> = {}) => ({ version: 1, data: { ...data, ...overrides } });

test('a valid report parses and keeps only the six non-personal context fields', () => {
  const report = parseFeedbackEnvelope(envelope());
  assert.ok(report);
  assert.deepEqual(Object.keys(report.context).sort(), ['appVersion', 'build', 'connection', 'platform', 'screen', 'viewport']);
  assert.equal(report.screenshotBase64, null);
});

test('personal data smuggled into the report or its context is rejected, not forwarded', () => {
  assert.equal(parseFeedbackEnvelope(envelope({ email: 'someone@example.com' })), null);
  assert.equal(parseFeedbackEnvelope(envelope({ context: { ...context, weightKg: 82 } })), null);
  assert.equal(parseFeedbackEnvelope(envelope({ context: { ...context, foodLog: 'chicken rice' } })), null);
  assert.equal(parseFeedbackEnvelope({ version: 2, data }), null);
});

test('message length, type and screenshot are capped and validated', () => {
  assert.equal(parseFeedbackEnvelope(envelope({ message: 'x'.repeat(2_001) })), null);
  assert.ok(parseFeedbackEnvelope(envelope({ message: 'x'.repeat(2_000) })));
  assert.equal(parseFeedbackEnvelope(envelope({ message: '' })), null);
  assert.equal(parseFeedbackEnvelope(envelope({ type: 'praise' })), null);
  assert.equal(parseFeedbackEnvelope(envelope({ screenshotBase64: 'not base64!' })), null);
  assert.throws(() => normalizeFeedbackMessage('   '));
  assert.throws(() => normalizeFeedbackMessage('x'.repeat(2_001)));
  assert.equal(normalizeFeedbackMessage('  typo in yoghurt  '), 'typo in yoghurt');
});

test('issue title is [Feedback] <type>: first 60 characters, and the body lists only the shown context', () => {
  const report = parseFeedbackEnvelope(envelope({ message: 'Line one\nline two '.repeat(6).trim() }))!;
  const title = feedbackIssueTitle(report);
  assert.match(title, /^\[Feedback\] bug: /);
  assert.equal(title.length, '[Feedback] bug: '.length + 60);
  assert.doesNotMatch(title, /\n/);
  const body = feedbackIssueBody(report);
  for (const line of feedbackContextLines(context)) assert.ok(body.includes(`- ${line}`), line);
  assert.match(body, /Screenshot: No/);
  assert.doesNotMatch(body, /@|kcal|kg\b/);
});

test('GitHub client creates the feedback label when missing, then opens the issue with it (GitHub mocked)', async () => {
  const report = parseFeedbackEnvelope(envelope())!;
  const calls: { url: string; method: string; body?: any; auth?: string }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string>;
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: headers.Authorization });
    if (url.endsWith('/labels/feedback')) return new Response('{}', { status: 404 });
    if (url.endsWith('/labels')) return new Response('{}', { status: 201 });
    return new Response(JSON.stringify({ number: 101, html_url: 'https://github.com/o/r/issues/101' }), { status: 201 });
  }) as typeof fetch;
  const issue = await createFeedbackGithubIssue(fetcher, { token: 'test-token', repository: 'o/r', report });
  assert.deepEqual(issue, { number: 101, url: 'https://github.com/o/r/issues/101' });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url.replace('https://api.github.com/repos/o/r', '')}`), ['GET /labels/feedback', 'POST /labels', 'POST /issues']);
  assert.ok(calls.every((c) => c.auth === 'Bearer test-token'));
  assert.equal(calls[2]!.body.title, feedbackIssueTitle(report));
  assert.deepEqual(calls[2]!.body.labels, ['feedback']);
});

test('GitHub client surfaces failures and rejects an unsafe repository name', async () => {
  const report = parseFeedbackEnvelope(envelope())!;
  const ok = (async (url: string) => url.endsWith('/issues') ? new Response('{}', { status: 403 }) : new Response('{}', { status: 200 })) as typeof fetch;
  await assert.rejects(createFeedbackGithubIssue(ok, { token: 't', repository: 'o/r', report }), /GITHUB_ISSUE_403/);
  await assert.rejects(createFeedbackGithubIssue(ok, { token: 't', repository: 'owner/repo/extra', report }), /GITHUB_REPOSITORY_INVALID/);
});
