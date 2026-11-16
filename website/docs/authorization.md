---
title: Authorization
sidebar_position: 2
---

# Authorization

The Comms SDK provides helper functions to implement OAuth 2.0 authentication for your application. This allows you to obtain access tokens on behalf of users to interact with the Comms API.

## Quick Start

For quick testing and development, you can use an API token directly:

```typescript
import { CommsApi } from '@todoist/comms-sdk'

const api = new CommsApi('your-api-token')
const user = await api.users.getSessionUser()
```

For production applications that need to access user data, use the OAuth 2.0 flow described below.

## OAuth 2.0 Flow

The SDK provides three main functions to handle OAuth authentication:

### 1. Generate a State Parameter

First, generate a secure random state parameter to prevent CSRF attacks:

```typescript
import { getAuthStateParameter } from '@todoist/comms-sdk'

const state = getAuthStateParameter()
// Returns a UUID v4 string like: "550e8400-e29b-41d4-a716-446655440000"

// Store this in your session to verify later
req.session.oauthState = state
```

### 2. Generate Authorization URL

Create the URL to redirect users to for authorization:

```typescript
import { getAuthorizationUrl, CommsScope } from '@todoist/comms-sdk'

const scopes: CommsScope[] = [
    'user:read',
    'comms:channels:read',
    'comms:content:read',
    'comms:content:write',
]

const authUrl = getAuthorizationUrl(
    'your-client-id', // Your OAuth client ID
    scopes, // Array of OAuth scopes
    state, // State parameter from step 1
    'https://yourapp.com/callback', // Optional redirect URI
)

// Redirect the user to authUrl
res.redirect(authUrl)
```

**Function Signature:**

```typescript
getAuthorizationUrl(
    clientId: string,
    scopes: CommsScope[],
    state: string,
    redirectUri?: string,
    baseUrl?: string,
): string
```

### 3. Exchange Authorization Code for Access Token

After the user authorizes your app, Comms redirects them back to your redirect URI with an authorization code. Exchange this code for an access token:

```typescript
import { getAuthToken } from '@todoist/comms-sdk'

// In your OAuth callback handler:
app.get('/callback', async (req, res) => {
    const code = req.query.code as string
    const state = req.query.state as string

    // Verify state matches what you stored
    if (state !== req.session.oauthState) {
        return res.status(400).send('Invalid state parameter')
    }

    // Exchange code for access token
    const tokenResponse = await getAuthToken({
        clientId: 'your-client-id',
        clientSecret: 'your-client-secret',
        code: code,
        redirectUri: 'https://yourapp.com/callback', // Must match authorization URL
    })

    // Store the access token securely
    req.session.accessToken = tokenResponse.accessToken

    // Now you can use the SDK
    const api = new CommsApi(tokenResponse.accessToken)
    const user = await api.users.getSessionUser()

    res.send(`Hello ${user.fullName}!`)
})
```

**Function Signature:**

```typescript
getAuthToken(
    args: {
        clientId: string
        clientSecret: string
        code: string
        redirectUri?: string
    },
    baseUrl?: string,
): Promise<{
    accessToken: string
    tokenType: string
    refreshToken?: string
    expiresIn?: number
    scope?: string
}>
```

### 4. Revoke Access Token

When a user logs out or revokes access, you can revoke the token:

```typescript
import { revokeAuthToken } from '@todoist/comms-sdk'

const success = await revokeAuthToken({
    clientId: 'your-client-id',
    clientSecret: 'your-client-secret',
    accessToken: userAccessToken,
})

if (success) {
    console.log('Token revoked successfully')
}
```

**Function Signature:**

```typescript
revokeAuthToken(
    args: {
        clientId: string
        clientSecret: string
        accessToken: string
    },
    baseUrl?: string,
): Promise<boolean>
```

## Available Scopes

The SDK includes a `CommsScope` type and a `COMMS_SCOPES` array of the OAuth scopes Todoist grants for the Comms API. Each scope is exact: `comms:content:write` doesn't include `comms:content:read`, so ask for both if you read and write.

| Scope                   | Grants                                                          |
| ----------------------- | --------------------------------------------------------------- |
| `user:read`             | Read the person's profile and settings                          |
| `user:write`            | Update the person's profile, settings, and status               |
| `workspaces:read`       | Read workspaces, members, and groups                            |
| `workspaces:write`      | Update workspaces, invite and remove members, manage groups     |
| `comms:channels:read`   | Read channels, including metadata and membership                |
| `comms:channels:write`  | Create and update channels, and manage their members            |
| `comms:channels:delete` | Delete or archive channels                                      |
| `comms:content:read`    | Read threads, comments, reactions, and attachments              |
| `comms:content:write`   | Create and update threads, comments, reactions, and attachments |
| `comms:content:delete`  | Delete threads, comments, reactions, and attachments            |
| `comms:messages:read`   | Read 1:1 and group chats and their messages                     |
| `comms:messages:write`  | Send, update, and pin chat messages, and start and manage chats |
| `comms:messages:delete` | Delete chat messages and remove people from chats               |

Reactions use the `comms:content:*` scopes, including on chat messages.

### Legacy Scopes

Older scope names such as `channels:read`, `threads:write` and `comments:remove` are still part of `CommsScope` so existing code compiles, but they're deprecated: Todoist doesn't offer them, and the Comms API checks the scopes above instead. `LEGACY_COMMS_SCOPES` lists them. The next major version removes them.

**Best Practice:** Only request the scopes your application actually needs.

## Complete Example

Here's a complete Express.js example showing the full OAuth flow:

```typescript
import express from 'express'
import session from 'express-session'
import {
    getAuthStateParameter,
    getAuthorizationUrl,
    getAuthToken,
    CommsApi,
    CommsScope,
} from '@todoist/comms-sdk'

const app = express()

app.use(
    session({
        secret: 'your-session-secret',
        resave: false,
        saveUninitialized: false,
    }),
)

// Step 1: Initiate OAuth flow
app.get('/auth/comms', (req, res) => {
    const state = getAuthStateParameter()
    req.session.oauthState = state

    const scopes: CommsScope[] = [
        'user:read',
        'comms:channels:read',
        'comms:content:read',
        'comms:content:write',
    ]

    const authUrl = getAuthorizationUrl(
        process.env.COMMS_CLIENT_ID!,
        scopes,
        state,
        'http://localhost:3000/auth/callback',
    )

    res.redirect(authUrl)
})

// Step 2: Handle callback
app.get('/auth/callback', async (req, res) => {
    const code = req.query.code as string
    const state = req.query.state as string

    if (state !== req.session.oauthState) {
        return res.status(400).send('Invalid state parameter')
    }

    try {
        const tokenResponse = await getAuthToken({
            clientId: process.env.COMMS_CLIENT_ID!,
            clientSecret: process.env.COMMS_CLIENT_SECRET!,
            code,
            redirectUri: 'http://localhost:3000/auth/callback',
        })

        req.session.accessToken = tokenResponse.accessToken

        const api = new CommsApi(tokenResponse.accessToken)
        const user = await api.users.getSessionUser()

        res.send(`Successfully authenticated as ${user.fullName}!`)
    } catch (error) {
        res.status(500).send('Authentication failed')
    }
})

app.listen(3000)
```

## Security Best Practices

1. **Store tokens securely** - Never expose tokens in client-side code or commit them to version control
2. **Use HTTPS** - Always use HTTPS for redirect URIs in production
3. **Verify state parameter** - Always verify the state parameter matches to prevent CSRF attacks
4. **Request minimal scopes** - Only request the OAuth scopes your application actually needs
5. **Handle errors** - Implement proper error handling for failed authentication or API calls

## TypeScript Types

The SDK exports these types for OAuth operations:

```typescript
import type {
    CommsScope,
    AuthTokenRequestArgs,
    AuthTokenResponse,
    RevokeAuthTokenRequestArgs,
} from '@todoist/comms-sdk'
```

## Additional Resources

- [OAuth 2.0 Authorization Code Flow](https://oauth.net/2/grant-types/authorization-code/)
