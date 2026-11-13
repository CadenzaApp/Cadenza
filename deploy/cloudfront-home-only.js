// CloudFront supplies viewer.ip; request headers cannot override it.
function handler(event) {
    if (event.viewer.ip !== '24.11.70.86') {
        return {
            statusCode: 403,
            statusDescription: 'Forbidden',
            headers: {
                'content-type': { value: 'text/plain; charset=utf-8' },
                'cache-control': { value: 'no-store' }
            },
            body: 'Home network access only.'
        };
    }
    return event.request;
}
