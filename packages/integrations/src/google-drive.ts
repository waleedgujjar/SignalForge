import { google } from 'googleapis';
import type { Readable } from 'node:stream';
import type {
  IntegrationProviderAdapter,
  IntegrationTokens,
  CloudFolder,
  CloudFile,
} from './types.js';
import { SUPPORTED_MIME_TYPES, MAX_FILE_SIZE } from './types.js';

const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

export class GoogleDriveAdapter implements IntegrationProviderAdapter {
  private clientId: string;
  private clientSecret: string;

  constructor(clientId: string, clientSecret: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  private createOAuth2Client(redirectUri?: string) {
    return new google.auth.OAuth2(this.clientId, this.clientSecret, redirectUri);
  }

  private getAuthenticatedClient(tokens: IntegrationTokens) {
    const client = this.createOAuth2Client();
    client.setCredentials({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expiry_date: tokens.expiresAt,
    });
    return client;
  }

  getAuthUrl(state: string, redirectUri: string): string {
    const client = this.createOAuth2Client(redirectUri);
    return client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
      state,
    });
  }

  async exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<{ tokens: IntegrationTokens; email: string }> {
    const client = this.createOAuth2Client(redirectUri);
    const { tokens: googleTokens } = await client.getToken(code);

    if (!googleTokens.access_token || !googleTokens.refresh_token) {
      throw new Error('Google did not return required tokens');
    }

    client.setCredentials(googleTokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const { data: userInfo } = await oauth2.userinfo.get();

    const integrationTokens: IntegrationTokens = {
      accessToken: googleTokens.access_token,
      refreshToken: googleTokens.refresh_token,
      expiresAt: googleTokens.expiry_date ?? Date.now() + 3600 * 1000,
    };

    return { tokens: integrationTokens, email: userInfo.email ?? 'unknown' };
  }

  async refreshTokens(tokens: IntegrationTokens): Promise<IntegrationTokens> {
    const client = this.createOAuth2Client();
    client.setCredentials({ refresh_token: tokens.refreshToken });
    const { credentials } = await client.refreshAccessToken();

    return {
      accessToken: credentials.access_token ?? tokens.accessToken,
      refreshToken: credentials.refresh_token ?? tokens.refreshToken,
      expiresAt: credentials.expiry_date ?? Date.now() + 3600 * 1000,
    };
  }

  async revokeAccess(tokens: IntegrationTokens): Promise<void> {
    const client = this.getAuthenticatedClient(tokens);
    try {
      await client.revokeToken(tokens.accessToken);
    } catch {
      // best-effort revocation
    }
  }

  async listFolders(
    tokens: IntegrationTokens,
    parentId?: string,
  ): Promise<CloudFolder[]> {
    const client = this.getAuthenticatedClient(tokens);
    const drive = google.drive({ version: 'v3', auth: client });

    const parent = parentId ?? 'root';
    const res = await drive.files.list({
      q: `'${parent}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name, parents, modifiedTime)',
      orderBy: 'name',
      pageSize: 100,
    });

    return (res.data.files ?? []).map((f) => ({
      id: f.id!,
      name: f.name!,
      parentId: f.parents?.[0] ?? null,
      modifiedAt: f.modifiedTime ?? new Date().toISOString(),
    }));
  }

  async listFiles(
    tokens: IntegrationTokens,
    folderId: string,
  ): Promise<CloudFile[]> {
    const client = this.getAuthenticatedClient(tokens);
    const drive = google.drive({ version: 'v3', auth: client });

    const mimeQuery = SUPPORTED_MIME_TYPES.map(
      (m) => `mimeType = '${m}'`,
    ).join(' or ');

    const res = await drive.files.list({
      q: `'${folderId}' in parents and (${mimeQuery}) and trashed = false`,
      fields: 'files(id, name, mimeType, size, modifiedTime, parents)',
      orderBy: 'name',
      pageSize: 200,
    });

    return (res.data.files ?? [])
      .filter((f) => {
        const size = parseInt(f.size ?? '0', 10);
        return size <= MAX_FILE_SIZE || f.mimeType === 'application/vnd.google-apps.spreadsheet';
      })
      .map((f) => ({
        id: f.id!,
        name: f.name!,
        mimeType: f.mimeType!,
        size: parseInt(f.size ?? '0', 10),
        modifiedAt: f.modifiedTime ?? new Date().toISOString(),
        parentId: f.parents?.[0] ?? null,
      }));
  }

  async downloadFile(
    tokens: IntegrationTokens,
    fileId: string,
  ): Promise<Readable> {
    const client = this.getAuthenticatedClient(tokens);
    const drive = google.drive({ version: 'v3', auth: client });

    const meta = await drive.files.get({
      fileId,
      fields: 'mimeType, size',
    });

    if (meta.data.mimeType === 'application/vnd.google-apps.spreadsheet') {
      const res = await drive.files.export(
        {
          fileId,
          mimeType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
        { responseType: 'stream' },
      );
      return res.data as unknown as Readable;
    }

    const size = parseInt(meta.data.size ?? '0', 10);
    if (size > MAX_FILE_SIZE) {
      throw new Error(`File exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`);
    }

    const res = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' },
    );
    return res.data as unknown as Readable;
  }
}
