export type GroupableExerciseBlock = {
  key: string;
  groupId: string | null;
};

export type SupersetLabel = {
  groupId: string;
  label: string;
  memberIndex: number;
  memberCount: number;
};

export function supersetLabels(blocks: GroupableExerciseBlock[]): Map<string, SupersetLabel> {
  const groups = new Map<string, GroupableExerciseBlock[]>();
  for (const block of blocks) {
    if (!block.groupId) continue;
    groups.set(block.groupId, [...(groups.get(block.groupId) ?? []), block]);
  }
  const result = new Map<string, SupersetLabel>();
  [...groups.entries()].forEach(([groupId, members], groupIndex) => {
    const prefix = alphaLabel(groupIndex);
    members.forEach((member, memberIndex) => result.set(member.key, {
      groupId,
      label: `${prefix}${memberIndex + 1}`,
      memberIndex,
      memberCount: members.length,
    }));
  });
  return result;
}

export function completionFlow(
  blocks: GroupableExerciseBlock[],
  blockKey: string,
): { nextBlockKey: string | null; startsRest: boolean } {
  const currentIndex = blocks.findIndex((block) => block.key === blockKey);
  const current = blocks[currentIndex];
  if (!current?.groupId) return { nextBlockKey: null, startsRest: true };
  const members = blocks.filter((block) => block.groupId === current.groupId);
  const memberIndex = members.findIndex((block) => block.key === blockKey);
  const next = members[memberIndex + 1];
  return next
    ? { nextBlockKey: next.key, startsRest: false }
    : { nextBlockKey: null, startsRest: true };
}

function alphaLabel(index: number): string {
  let value = index + 1;
  let label = '';
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}
