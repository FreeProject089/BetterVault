import { describe, it, expect } from 'vitest';
import { parseImportFile, exportVaultAsJson, exportVaultAsCsv } from '../src/import_export/importEngine';
import { CredentialItem, Task } from '../src/types/vault';

describe('Import & Export Engine (Bitwarden, 1Password, CSV, JSON)', () => {
  it('should parse standard Bitwarden JSON export format', () => {
    const bitwardenJson = JSON.stringify({
      folders: [],
      items: [
        {
          id: 'bw-1',
          name: 'GitHub Account',
          notes: 'Important dev account',
          login: {
            uris: [{ uri: 'https://github.com/login' }],
            username: 'dev@bum.sh',
            password: 'SuperSecretGitHubPassword1!',
            totp: 'JBSWY3DPEHPK3PXP'
          }
        },
        {
          id: 'bw-2',
          name: 'ProtonMail',
          notes: 'Secure email',
          login: {
            uris: [{ uri: 'https://proton.me' }],
            username: 'security@bum.sh',
            password: 'ProtonPassword9988!!'
          }
        }
      ]
    });

    const result = parseImportFile(bitwardenJson, 'bitwarden_export.json');
    expect(result.sourceFormat).toBe('Bitwarden JSON');
    expect(result.count).toBe(2);
    expect(result.credentials[0].title).toBe('GitHub Account');
    expect(result.credentials[0].username).toBe('dev@bum.sh');
    expect(result.credentials[0].totpSecret).toBe('JBSWY3DPEHPK3PXP');
    expect(result.credentials[1].title).toBe('ProtonMail');
  });

  it('should parse standard CSV format (Bitwarden / Chrome / 1Password)', () => {
    const csvData = `folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp
,0,login,"Cloudflare DNS","Primary domain DNS",,0,"https://dash.cloudflare.com","admin@bum.sh","CloudflarePass123!",""
,0,login,"AWS Console","Root account",,0,"https://aws.amazon.com","aws-admin","AwsConsoleMaster456!",""`;

    const result = parseImportFile(csvData, 'vault_export.csv');
    expect(result.sourceFormat).toBe('CSV (vault_export.csv)');
    expect(result.count).toBe(2);
    expect(result.credentials[0].title).toBe('Cloudflare DNS');
    expect(result.credentials[0].username).toBe('admin@bum.sh');
    expect(result.credentials[1].title).toBe('AWS Console');
  });

  it('should accurately export and re-import BetterVault JSON format', () => {
    const now = Date.now();
    const mockCreds: CredentialItem[] = [
      {
        id: 'c1',
        vaultId: 'v1',
        title: 'Server Root',
        username: 'root',
        password: 'RootPass12345!',
        website: 'ssh://192.168.1.100',
        domain: '192.168.1.100',
        notes: 'Main node',
        tags: ['prod', 'linux'],
        createdAt: now,
        updatedAt: now
      }
    ];

    const mockTasks: Task[] = [
      {
        id: 't1',
        vaultId: 'v1',
        title: 'Rotate TLS Certificates',
        status: 'in_progress',
        priority: 'high',
        tags: ['ops'],
        createdAt: now,
        updatedAt: now
      }
    ];

    const exportedJson = exportVaultAsJson(mockCreds, mockTasks);
    const parsed = parseImportFile(exportedJson, 'bettervault-backup.json');

    expect(parsed.sourceFormat).toBe('BetterVault JSON');
    expect(parsed.count).toBe(2);
    expect(parsed.credentials[0].title).toBe('Server Root');
    expect(parsed.credentials[0].tags).toContain('prod');
    expect(parsed.tasks.length).toBe(1);
    expect(parsed.tasks[0].title).toBe('Rotate TLS Certificates');
  });

  it('should export valid CSV format with proper RFC 4180 quoting and Bitwarden compatibility', () => {
    const mockCreds: CredentialItem[] = [
      {
        id: 'c1',
        vaultId: 'v1',
        title: 'Comma, Title "Quotes"',
        username: 'quoted@test.com',
        password: 'pwd',
        website: 'https://example.com',
        domain: 'example.com',
        notes: 'line1\nline2',
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ];

    const csv = exportVaultAsCsv(mockCreds);
    expect(csv).toContain('folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp');
    expect(csv).toContain('"Comma, Title ""Quotes"""');
    expect(csv).toContain('"quoted@test.com"');
    expect(csv).toContain('"https://example.com"');
  });
});
