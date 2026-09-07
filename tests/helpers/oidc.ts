import { createHash, generateKeyPairSync, createSign, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export type OidcUser = { sub: string; email: string; name: string; email_verified: boolean };

function readBody(request: IncomingMessage) {
  return new Promise<string>(resolve => {
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(chunk as Buffer));
    request.on('end', () => resolve(Buffer.concat(chunks).toString()));
  });
}
function send(response: ServerResponse, status: number, body: unknown, type = 'application/json') {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  response.writeHead(status, { 'content-type': type });
  response.end(text);
}
function signJwt(privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'], kid: string, payload: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${body}`);
  return `${header}.${body}.${signer.sign(privateKey).toString('base64url')}`;
}

export async function startOidcProvider() {
  const kid = 'test-key';
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' };
  const clientId = 'planner-test';
  const clientSecret = 'oidc-test-secret';
  let user: OidcUser = { sub: 'pocket-user-1', email: 'oidc@example.test', name: 'OIDC Mitglied', email_verified: true };
  let omitNonce = false;
  const codes = new Map<string, { nonce?: string; challenge: string; redirectUri: string }>();
  const access = new Map<string, OidcUser>();
  let issuer = 'http://127.0.0.1';
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', issuer);
    if (request.method === 'GET' && url.pathname === '/.well-known/openid-configuration') {
      return send(response, 200, {
        issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
        userinfo_endpoint: `${issuer}/userinfo`, jwks_uri: `${issuer}/jwks`, end_session_endpoint: `${issuer}/session/end`,
        id_token_signing_alg_values_supported: ['RS256'], response_types_supported: ['code'],
        subject_types_supported: ['public'], token_endpoint_auth_methods_supported: ['client_secret_post'],
        code_challenge_methods_supported: ['S256'], scopes_supported: ['openid', 'email', 'profile'],
      });
    }
    if (request.method === 'GET' && url.pathname === '/jwks') return send(response, 200, { keys: [jwk] });
    if (request.method === 'GET' && url.pathname === '/authorize') {
      const redirectUri = url.searchParams.get('redirect_uri') ?? '';
      const state = url.searchParams.get('state') ?? '';
      const code = randomUUID();
      codes.set(code, {
        nonce: omitNonce ? undefined : url.searchParams.get('nonce') ?? undefined,
        challenge: url.searchParams.get('code_challenge') ?? '',
        redirectUri,
      });
      const target = new URL(redirectUri);
      target.searchParams.set('code', code);
      target.searchParams.set('state', state);
      response.writeHead(302, { location: target.href });
      return response.end();
    }
    if (request.method === 'POST' && url.pathname === '/token') {
      const body = new URLSearchParams(await readBody(request));
      const issued = codes.get(body.get('code') ?? '');
      if (!issued || body.get('client_id') !== clientId || body.get('client_secret') !== clientSecret) {
        return send(response, 400, { error: 'invalid_grant' });
      }
      const verifier = body.get('code_verifier') ?? '';
      const expected = createHash('sha256').update(verifier).digest('base64url');
      if (issued.challenge !== expected || body.get('redirect_uri') !== issued.redirectUri) {
        return send(response, 400, { error: 'invalid_grant' });
      }
      codes.delete(body.get('code') ?? '');
      const now = Math.floor(Date.now() / 1000);
      const accessToken = randomUUID();
      access.set(accessToken, user);
      const idToken = signJwt(privateKey, kid, {
        iss: issuer, sub: user.sub, aud: clientId, iat: now, exp: now + 300,
        email: user.email, email_verified: user.email_verified, name: user.name,
        ...(issued.nonce ? { nonce: issued.nonce } : {}),
      });
      return send(response, 200, { access_token: accessToken, token_type: 'Bearer', expires_in: 300, id_token: idToken, scope: 'openid email profile' });
    }
    if (request.method === 'GET' && url.pathname === '/userinfo') {
      const token = request.headers.authorization?.replace(/^Bearer /i, '');
      const profile = token ? access.get(token) : undefined;
      if (!profile) return send(response, 401, { error: 'invalid_token' });
      return send(response, 200, { sub: profile.sub, email: profile.email, email_verified: profile.email_verified, name: profile.name });
    }
    if (request.method === 'GET' && url.pathname === '/session/end') {
      response.writeHead(302, { location: url.searchParams.get('post_logout_redirect_uri') ?? issuer });
      return response.end();
    }
    send(response, 404, { error: 'not_found' });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('OIDC test provider failed to bind');
  issuer = `http://127.0.0.1:${address.port}`;
  return {
    issuer, clientId, clientSecret,
    setUser(next: OidcUser) { user = next; },
    omitNonce(value = true) { omitNonce = value; },
    async close() { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); },
  };
}
