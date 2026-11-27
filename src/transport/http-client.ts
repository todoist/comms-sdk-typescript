import type {
    CustomFetch,
    CustomHeaders,
    HttpMethod,
    HttpResponse,
    RequestConfig,
} from '../types/http'
import { snakeCaseKeys } from '../utils/case-conversion'
import { mergeHeaders, resolveCustomHeaders } from '../utils/headers'
import { fetchWithRetry } from './fetch-with-retry'

export function paramsSerializer(params: Record<string, unknown>): string {
    const qs = new URLSearchParams()

    Object.keys(params).forEach((key) => {
        const value = params[key]
        if (value != null) {
            if (Array.isArray(value)) {
                qs.append(key, value.join(','))
            } else {
                qs.append(key, String(value))
            }
        }
    })

    return qs.toString()
}

const JSON_CONTENT_TYPE = 'application/json'
const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded'

function getAuthHeader(apiToken: string): string {
    return `Bearer ${apiToken}`
}

function getRequestConfiguration(
    baseURL: string,
    apiToken?: string,
    requestId?: string,
    customHeaders?: CustomHeaders,
    formEncoded?: boolean,
): RequestConfig {
    const authHeader = apiToken ? { Authorization: getAuthHeader(apiToken) } : undefined
    const requestIdHeader = requestId ? { 'X-Request-Id': requestId } : undefined
    // Custom headers sit below auth and request id so they can never clobber them.
    const headers = mergeHeaders(
        { 'Content-Type': formEncoded ? FORM_CONTENT_TYPE : JSON_CONTENT_TYPE },
        resolveCustomHeaders(customHeaders),
        authHeader,
        requestIdHeader,
    )

    return { baseURL, headers, timeout: 30000 }
}

export type RequestArgs = {
    httpMethod: HttpMethod
    baseUri: string
    relativePath: string
    apiToken?: string
    payload?: Record<string, unknown>
    requestId?: string
    headers?: CustomHeaders
    customFetch?: CustomFetch
    formEncoded?: boolean
    /** Resolve on a 2xx response without reading its body. Error responses are still read. */
    ignoreResponseBody?: boolean
}

export async function request<T>(args: RequestArgs): Promise<HttpResponse<T>> {
    const {
        httpMethod,
        baseUri,
        relativePath,
        apiToken,
        payload,
        requestId,
        headers,
        customFetch,
        formEncoded,
        ignoreResponseBody,
    } = args

    const config = getRequestConfiguration(baseUri, apiToken, requestId, headers, formEncoded)
    const url = new URL(relativePath, config.baseURL).toString()

    const options: RequestInit & { timeout?: number; ignoreResponseBody?: boolean } = {
        method: httpMethod,
        headers: config.headers,
        timeout: config.timeout,
        ...(ignoreResponseBody ? { ignoreResponseBody } : {}),
    }

    if (httpMethod === 'GET' && payload) {
        const searchParams = paramsSerializer(snakeCaseKeys(payload) as Record<string, unknown>)
        const urlWithParams = searchParams ? `${url}?${searchParams}` : url
        return fetchWithRetry<T>(urlWithParams, options, 3, customFetch)
    }

    if (payload && httpMethod !== 'GET') {
        const body = snakeCaseKeys(payload) as Record<string, unknown>
        options.body = formEncoded ? paramsSerializer(body) : JSON.stringify(body)
    }

    return fetchWithRetry<T>(url, options, 3, customFetch)
}

export function isSuccess(response: HttpResponse): boolean {
    return response.status >= 200 && response.status < 300
}
