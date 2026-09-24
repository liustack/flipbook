// Every public identifier derives from these two strings. test/names.test.ts
// pins package.json, the launchers and SKILL.md to them.
export const OWNER = 'liustack';
export const NAME = 'flipbook';

export const PACKAGE_NAME = `@${OWNER}/${NAME}`;
export const COMMAND_NAME = NAME;
export const SKILL_NAME = NAME;
export const REPO = `${OWNER}/${NAME}`;
export const REPO_URL = `https://github.com/${REPO}`;
