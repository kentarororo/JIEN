import { feedbackIssueBody, feedbackIssueTitle, type FeedbackRequest } from './feedback-contract.ts';

export async function createFeedbackGithubIssue(
  fetcher: typeof fetch,
  input: { token: string; repository: string; report: FeedbackRequest },
): Promise<{ number: number; url: string }> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repository)) throw new Error('GITHUB_REPOSITORY_INVALID');
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${input.token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'JIEN-feedback-edge-function',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const labelUrl = `https://api.github.com/repos/${input.repository}/labels/feedback`;
  const label = await fetcher(labelUrl, { headers });
  if (label.status === 404) {
    const created = await fetcher(`https://api.github.com/repos/${input.repository}/labels`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'feedback', color: '1f6feb', description: 'In-app tester feedback' }),
    });
    if (!created.ok && created.status !== 422) throw new Error(`GITHUB_LABEL_${created.status}`);
  } else if (!label.ok) {
    throw new Error(`GITHUB_LABEL_${label.status}`);
  }
  const response = await fetcher(`https://api.github.com/repos/${input.repository}/issues`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: feedbackIssueTitle(input.report),
      body: feedbackIssueBody(input.report),
      labels: ['feedback'],
    }),
  });
  if (!response.ok) throw new Error(`GITHUB_ISSUE_${response.status}`);
  const body = await response.json() as { number?: unknown; html_url?: unknown };
  if (!Number.isInteger(body.number) || typeof body.html_url !== 'string') throw new Error('GITHUB_RESPONSE_INVALID');
  return { number: body.number as number, url: body.html_url };
}
