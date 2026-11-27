import { beforeAll, describe, expect, it } from 'vitest'
import { CommsApi } from './comms-api'
import type { CustomFetch } from './types/http'
import { generateId } from './utils/uuidv7'

// Every call the SDK makes, checked against the API spec the Comms server
// publishes: the route exists, takes this method, and reads every field sent.
// The server ignores fields it doesn't know, so a misnamed field fails
// silently in production. Here it fails loudly. This reads the live spec, so
// it runs apart from the unit tests, with `npm run test:contract`.
const SPEC_URL = process.env.COMMS_OPENAPI_URL ?? 'https://comms.todoist.com/api/openapi.json'

type Schema = { $ref?: string; properties?: Record<string, unknown>; required?: string[] }
type Operation = {
    parameters?: { name: string; in: string; required?: boolean }[]
    requestBody?: { content: Record<string, { schema: Schema }> }
}
type Spec = {
    paths: Record<string, Record<string, Operation>>
    components: { schemas: Record<string, Schema> }
}
type Sent = { method: string; path: string; contentType?: string; fields: string[] }

// Where the SDK and the server disagree today. Fixing one fails the test
// until its line here goes, and any new one fails it too, so this only shrinks.
const KNOWN_PROBLEMS: { [K in CallName]?: string[] } = {
    'users.getUser': ['GET users/getone: the server ignores "as_list"'],
    'workspaceUsers.getWorkspaceUsers': ['GET workspace_users/get: the server ignores "archived"'],
    'workspaceUsers.resendInvite': [
        'POST workspace_users/resend_invite: the server has no such route',
    ],
    'channels.createChannel': ['POST channels/add: the server ignores "icon"'],
    'channels.updateChannel': ['POST channels/update: the server ignores "icon"'],
    'threads.getThreads': ['GET threads/get: the server ignores "archived"'],
    'conversations.updateConversation': [
        'POST conversations/update: the server ignores "archived"',
    ],
    'conversationMessages.getMessages': [
        'GET conversation_messages/get: the server ignores "cursor"',
    ],
    'inbox.getInbox': ['GET inbox/get: the server ignores "cursor"'],
    'inbox.archiveAll': ['POST inbox/archive_all: the server ignores "channel_ids"'],
    'search.search': [
        'GET search: the server ignores "author_ids"',
        'GET search: the server ignores "mention_self"',
        'GET search: the server ignores "date_from"',
        'GET search: the server ignores "date_to"',
        'GET search: the server requires "query"',
    ],
    'search.searchThread': [
        'GET search/thread: the server ignores "limit"',
        'GET search/thread: the server ignores "cursor"',
    ],
    'search.searchConversation': [
        'GET search/conversation: the server ignores "limit"',
        'GET search/conversation: the server ignores "cursor"',
    ],
    'attachments.upload': [
        'POST attachments/upload: the server ignores "file_size"',
        'POST attachments/upload: the server ignores "underlying_type"',
    ],
}

// Routes the server has but leaves out of the spec it publishes: sign-in,
// which only the first-party apps use, and image reads.
const UNPUBLISHED = [
    /^users\/(register|login\w*|logout|mfa\/challenge|check_email)$/,
    /^files\/(image|conversation_image)\//,
]

const ID = generateId()
const WS = 1
const USER = 2
const GROUP = generateId()
const EMAIL = 'someone@example.com'
const DATE = new Date(0)
const AUDIENCE = { recipients: [USER], groups: [GROUP], notifyAudience: 'thread' as const }
const MENTIONS = { actions: [], directMentions: [USER], directGroupMentions: [GROUP] }
const ATTACHMENTS = { attachments: [{ attachmentId: ID, urlType: 'file' }] }
const PAGE = { limit: 1, cursor: ID }
const CHANNEL_SETTINGS = {
    color: 1,
    public: true,
    description: 'd',
    useDefaultRecipients: true,
    defaultGroups: [GROUP],
    defaultRecipients: [USER],
    isFavorited: true,
    icon: 1,
}
// A reaction goes on one of these. The SDK sends the first it finds, and
// MORE_SHAPES sends the others.
const REACTION_TARGET = { threadId: ID, commentId: ID, messageId: ID }
const THREAD_ACTION = {
    id: ID,
    content: 'c',
    clientRequestId: ID,
    ...AUDIENCE,
    ...MENTIONS,
    ...ATTACHMENTS,
}

type Arguments<F> = F extends (...args: infer P) => Promise<unknown>
    ? { [I in keyof P]-?: Required<P[I]> }
    : never
type Calls = {
    [C in Exclude<keyof CommsApi, 'close'>]: {
        [M in keyof CommsApi[C] as CommsApi[C][M] extends (...args: never[]) => Promise<unknown>
            ? M
            : never]: Arguments<CommsApi[C][M]>
    }
}
type CallName = { [C in keyof Calls]: `${C}.${keyof Calls[C] & string}` }[keyof Calls]

// The arguments each SDK method is called with. The type makes optional fields
// required, so a new method or a new option fails the type check until it's
// listed here, and every field the SDK can send gets checked.
const CALLS: Calls = {
    users: {
        register: [
            {
                name: 'n',
                email: EMAIL,
                password: 'p',
                lang: 'en',
                acceptTerms: true,
            },
        ],
        login: [{ email: EMAIL, password: 'p', setSessionCookie: true }],
        loginWithToken: [],
        loginWithTodoist: [],
        loginWithGoogle: [
            {
                idToken: ID,
                nonce: ID,
                timezone: 'UTC',
                lang: 'en',
                mfaToken: ID,
            },
        ],
        mfaChallenge: [{ challengeId: ID, factor: 'totp', methodType: 'app' }],
        logout: [],
        getSessionUser: [],
        getUser: [{ id: USER, workspaceId: WS, asList: true }],
        getUserByEmail: [EMAIL],
        update: [
            {
                name: 'n',
                password: 'p',
                timezone: 'UTC',
                lang: 'en',
                dateFormat: 'd',
                timeFormat: 't',
                theme: 1,
            },
        ],
        setStatus: [
            {
                message: 'm',
                emoji: 'e',
                activeUntil: DATE,
                effects: { pauseNotifications: { scope: { mode: 'all' } } },
            },
        ],
        clearStatus: [],
        updatePassword: [{ newPassword: 'p', currentPassword: 'p' }],
        removeAvatar: [],
        invalidateToken: [],
        validateToken: [ID],
        heartbeat: [{ workspaceId: WS, platform: 'api' }],
        resetPresence: [WS],
        checkEmail: [EMAIL],
        getUnsubscribeSettings: [],
        updateUnsubscribeSettings: [
            {
                general: true,
                productUpdates: true,
                tips: true,
            },
        ],
    },
    workspaces: {
        getWorkspaces: [],
        getWorkspace: [WS],
        getDefaultWorkspace: [],
        createWorkspace: ['n'],
        updateWorkspace: [WS, 'n'],
        removeWorkspace: [WS],
        getPublicChannels: [WS],
    },
    workspaceUsers: {
        getWorkspaceUsers: [
            {
                workspaceId: WS,
                archived: true,
                includeRemoved: true,
            },
        ],
        getWorkspaceUserIds: [WS],
        getUserById: [{ workspaceId: WS, userId: USER }],
        getUsersByIds: [{ workspaceId: WS, userIds: [USER] }],
        getUserByEmail: [{ workspaceId: WS, email: EMAIL }],
        getUserInfo: [{ workspaceId: WS, userId: USER }],
        getUserLocalTime: [{ workspaceId: WS, userId: USER }],
        addUser: [{ workspaceId: WS, email: EMAIL, userType: 'GUEST' }],
        updateUser: [
            {
                workspaceId: WS,
                userType: 'GUEST',
                email: EMAIL,
                userId: USER,
            },
        ],
        removeUser: [{ workspaceId: WS, email: EMAIL, userId: USER }],
        resendInvite: [{ workspaceId: WS, email: EMAIL, userId: USER }],
    },
    channels: {
        getChannels: [{ workspaceId: WS, archived: true }],
        getChannel: [ID],
        createChannel: [
            {
                workspaceId: WS,
                name: 'n',
                id: ID,
                userIds: [USER],
                ...CHANNEL_SETTINGS,
            },
        ],
        updateChannel: [
            {
                id: ID,
                name: 'n',
                ...CHANNEL_SETTINGS,
            },
        ],
        updateFilters: [{ id: ID, filterClosed: 'all' }],
        deleteChannel: [ID],
        archiveChannel: [ID],
        unarchiveChannel: [ID],
        favoriteChannel: [ID],
        unfavoriteChannel: [ID],
        addUser: [{ id: ID, userId: USER }],
        addUsers: [{ id: ID, userIds: [USER] }],
        removeUser: [{ id: ID, userId: USER }],
        removeUsers: [{ id: ID, userIds: [USER] }],
    },
    threads: {
        getThreads: [
            {
                workspaceId: WS,
                channelId: ID,
                archived: true,
                newerThan: DATE,
                olderThan: DATE,
                limit: 1,
            },
        ],
        getThread: [ID],
        createThread: [
            {
                channelId: ID,
                content: 'c',
                title: 't',
                id: ID,
                ...AUDIENCE,
                ...ATTACHMENTS,
            },
        ],
        updateThread: [{ id: ID, title: 't', content: 'c', silent: true }],
        deleteThread: [ID],
        saveThread: [ID],
        unsaveThread: [ID],
        pinThread: [ID],
        unpinThread: [ID],
        moveToChannel: [{ id: ID, toChannel: ID }],
        markRead: [{ id: ID, objIndex: 1 }],
        markUnread: [{ id: ID, objIndex: 1 }],
        markUnreadForOthers: [{ id: ID, objIndex: 1 }],
        markAllRead: [{ workspaceId: WS, channelId: ID }],
        clearUnread: [WS],
        getUnread: [WS],
        muteThread: [{ id: ID, minutes: 1 }],
        unmuteThread: [ID],
        closeThread: [THREAD_ACTION],
        reopenThread: [THREAD_ACTION],
    },
    groups: {
        getGroups: [WS],
        getGroup: [{ id: GROUP, workspaceId: WS }],
        createGroup: [
            {
                workspaceId: WS,
                name: 'n',
                id: GROUP,
                description: 'd',
                userIds: [USER],
            },
        ],
        updateGroup: [{ id: GROUP, workspaceId: WS, name: 'n', description: 'd' }],
        deleteGroup: [{ id: GROUP, workspaceId: WS }],
        addUser: [{ id: GROUP, workspaceId: WS, userId: USER }],
        addUsers: [{ id: GROUP, workspaceId: WS, userIds: [USER] }],
        removeUser: [{ id: GROUP, workspaceId: WS, userId: USER }],
        removeUsers: [{ id: GROUP, workspaceId: WS, userIds: [USER] }],
    },
    conversations: {
        getConversations: [
            {
                workspaceId: WS,
                archived: true,
                olderThan: DATE,
                beforeId: ID,
                limit: 1,
            },
        ],
        getConversation: [ID],
        getOrCreateConversation: [{ workspaceId: WS, userIds: [USER], id: ID }],
        updateConversation: [
            {
                id: ID,
                title: 't',
                archived: true,
                silent: true,
            },
        ],
        archiveConversation: [ID],
        unarchiveConversation: [ID],
        addUser: [{ id: ID, userId: USER }],
        addUsers: [{ id: ID, userIds: [USER] }],
        removeUser: [{ id: ID, userId: USER }],
        removeUsers: [{ id: ID, userIds: [USER] }],
        markRead: [{ id: ID, objIndex: 1, messageId: ID }],
        markUnread: [{ id: ID, objIndex: 1, messageId: ID }],
        getUnread: [WS],
        clearUnread: [WS],
        muteConversation: [{ id: ID, minutes: 1 }],
        unmuteConversation: [ID],
    },
    comments: {
        getComments: [
            {
                threadId: ID,
                newerThan: DATE,
                olderThan: DATE,
                limit: 1,
            },
        ],
        getComment: [ID],
        createComment: [
            {
                threadId: ID,
                content: 'c',
                id: ID,
                clientRequestId: ID,
                ...AUDIENCE,
                ...MENTIONS,
                ...ATTACHMENTS,
            },
        ],
        updateComment: [{ id: ID, content: 'c' }],
        deleteComment: [ID],
        markPosition: [{ threadId: ID, commentId: ID }],
        pinComment: [ID],
        unpinComment: [ID],
        getPinnedComments: [ID],
    },
    conversationMessages: {
        getMessages: [
            {
                conversationId: ID,
                newerThan: DATE,
                olderThan: DATE,
                ...PAGE,
            },
        ],
        getMessage: [ID],
        createMessage: [
            {
                conversationId: ID,
                content: 'c',
                id: ID,
                notify: true,
                ...MENTIONS,
                ...ATTACHMENTS,
            },
        ],
        updateMessage: [
            {
                id: ID,
                content: 'c',
                ...MENTIONS,
                ...ATTACHMENTS,
            },
        ],
        deleteMessage: [ID],
        pinMessage: [ID],
        unpinMessage: [ID],
        getPinnedMessages: [ID],
    },
    inbox: {
        getInbox: [
            {
                workspaceId: WS,
                newerThan: DATE,
                olderThan: DATE,
                archiveFilter: 'all',
                ...PAGE,
            },
        ],
        getCount: [WS],
        archiveThread: [ID],
        unarchiveThread: [ID],
        markAllRead: [WS],
        archiveAll: [{ workspaceId: WS, channelIds: [ID], olderThan: DATE }],
    },
    reactions: {
        add: [{ ...REACTION_TARGET, reaction: '👍' }],
        get: [REACTION_TARGET],
        remove: [{ ...REACTION_TARGET, reaction: '👍' }],
    },
    search: {
        search: [
            {
                workspaceId: WS,
                type: 'all',
                channelIds: [ID],
                authorIds: [USER],
                dateFrom: '2026-01-01',
                dateTo: '2026-01-02',
                query: 'q',
                mentionSelf: true,
                ...PAGE,
            },
        ],
        searchThread: [{ query: 'q', threadId: ID, ...PAGE }],
        searchConversation: [{ query: 'q', conversationId: ID, ...PAGE }],
    },
    attachments: {
        readImage: [ID, ID],
        readConversationImage: [ID, ID],
        upload: [
            {
                workspaceId: WS,
                file: new Uint8Array([1]),
                fileName: 'f.png',
                contentType: 'image/png',
                attachmentId: ID,
            },
        ],
    },
    hooks: {
        subscribe: [
            {
                targetUrl: 'https://example.com',
                event: 'message_added',
                workspaceId: WS,
                channelId: ID,
                threadId: ID,
                conversationId: ID,
            },
        ],
        unsubscribe: [{ targetUrl: 'https://example.com' }],
    },
}

// Calls that take one of several shapes. CALLS fills in every field, so it
// sends only one shape; these send the others.
const MORE_SHAPES: { [K in CallName]?: ((api: CommsApi) => Promise<unknown>)[] } = {
    'reactions.add': [
        (api) => api.reactions.add({ commentId: ID, reaction: '👍' }),
        (api) => api.reactions.add({ messageId: ID, reaction: '👍' }),
    ],
    'reactions.get': [
        (api) => api.reactions.get({ commentId: ID }),
        (api) => api.reactions.get({ messageId: ID }),
    ],
    'reactions.remove': [
        (api) => api.reactions.remove({ commentId: ID, reaction: '👍' }),
        (api) => api.reactions.remove({ messageId: ID, reaction: '👍' }),
    ],
    'search.search': [(api) => api.search.search({ workspaceId: WS, mentionSelf: true })],
}

// Records each request instead of sending it, and answers it with an error
// so the call stops there.
function recordingFetch(sent: Sent[]): CustomFetch {
    return async (url, options = {}) => {
        const { pathname, searchParams } = new URL(url)
        const contentType = new Headers(options.headers).get('content-type')?.split(';')[0]
        const body = options.body == null ? undefined : await new Response(options.body).text()
        sent.push({
            method: options.method ?? 'GET',
            path: pathname,
            ...(body === undefined
                ? { fields: [...searchParams.keys()] }
                : { contentType, fields: bodyFields(body, contentType) }),
        })
        return {
            ok: false,
            status: 400,
            statusText: '',
            headers: {},
            text: async () => '',
            json: async () => null,
        }
    }
}

function bodyFields(body: string, contentType: string | undefined): string[] {
    if (contentType === 'multipart/form-data') {
        return [...body.matchAll(/; name="([^"]+)"/g)].map((match) => match[1])
    }
    if (contentType === 'application/x-www-form-urlencoded') {
        return [...new URLSearchParams(body).keys()]
    }
    return Object.keys(JSON.parse(body))
}

function problemsWith(spec: Spec, { method, path, contentType, fields }: Sent): string[] {
    const endpoint = path.replace(/^\/api\/v[^/]+\//, '')
    const call = `${method} ${endpoint}`
    const route = spec.paths[`/api/v{api_version}/${endpoint}`]
    if (!route) {
        if (UNPUBLISHED.some((pattern) => pattern.test(endpoint))) return []
        return [`${call}: the server has no such route`]
    }
    const operation = route[method.toLowerCase()]
    if (!operation) {
        return [`${call}: the server only takes ${Object.keys(route).join(', ').toUpperCase()}`]
    }

    const query = (operation.parameters ?? []).filter((param) => param.in === 'query')
    const required = query.filter((param) => param.required).map((param) => param.name)
    const accepted = query.map((param) => param.name)
    if (method !== 'GET') {
        const content = operation.requestBody?.content ?? {}
        if (contentType && fields.length && !content[contentType]) {
            const reads = Object.keys(content).join(', ') || 'no body'
            return [`${call}: sends ${contentType}, the server reads ${reads}`]
        }
        // A request with no body is held to the body the route takes, so a
        // call that drops its whole payload shows what's missing.
        const declared = (contentType && content[contentType]) || Object.values(content)[0]
        const ref = declared?.schema.$ref
        const schema = ref ? spec.components.schemas[ref.split('/').pop() ?? ''] : declared?.schema
        accepted.push(...Object.keys(schema?.properties ?? {}))
        required.push(...(schema?.required ?? []))
    }

    return [
        ...fields
            .filter((field) => !accepted.includes(field))
            .map((field) => `${call}: the server ignores "${field}"`),
        ...required
            .filter((field) => !fields.includes(field))
            .map((field) => `${call}: the server requires "${field}"`),
    ]
}

let spec: Spec

beforeAll(async () => {
    const response = await fetch(SPEC_URL)
    expect(response.ok, `fetching ${SPEC_URL}`).toBe(true)
    spec = (await response.json()) as Spec
})

describe.each(Object.entries(CALLS))('%s', (client, methods) => {
    it.each(Object.entries(methods))('%s', async (method, args) => {
        const name = `${client}.${method}` as CallName
        const sent: Sent[] = []
        const api = new CommsApi('token', { customFetch: recordingFetch(sent) })
        const calls = api[client as keyof Calls] as unknown as Record<
            string,
            (...args: unknown[]) => Promise<unknown>
        >
        await calls[method](...args).catch(() => {})
        for (const shape of MORE_SHAPES[name] ?? []) await shape(api).catch(() => {})

        expect(sent, 'the call sent no request').not.toHaveLength(0)
        const problems = new Set(sent.flatMap((request) => problemsWith(spec, request)))
        expect([...problems].toSorted()).toEqual((KNOWN_PROBLEMS[name] ?? []).toSorted())
    })
})
