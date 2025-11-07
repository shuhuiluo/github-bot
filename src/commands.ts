import type { PlainMessage, SlashCommand } from '@towns-protocol/proto'

const commands = [
    {
        name: 'help',
        description: 'Get help with bot commands',
    },
    {
        name: 'time',
        description: 'Get the current time',
    },
    {
        name: 'github',
        description: 'Manage GitHub subscriptions (subscribe, unsubscribe, status)',
    },
    {
        name: 'gh-pr',
        description: 'Show GitHub pull request details (usage: /gh-pr owner/repo #123)',
    },
    {
        name: 'gh-issue',
        description: 'Show GitHub issue details (usage: /gh-issue owner/repo #123)',
    },
] as const satisfies PlainMessage<SlashCommand>[]

export default commands
