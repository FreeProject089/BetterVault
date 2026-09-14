import { describe, it, expect } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { CredentialItem } from '../src/types/vault';
import { buildKdbx4, KdbxError, parseKdbx, parseKeePassXml } from '../src/import_export/keepass';
import { parse1pux } from '../src/import_export/onepassword';
import { exportCredentialsAsCxf, parseCxf } from '../src/import_export/cxf';
import { decryptExport, encryptExport } from '../src/import_export/encryptedExport';
import { parseImportData, PasswordRequiredError } from '../src/import_export/importRouter';
import { normalizeTotpInput, parseOtpAuthUri } from '../src/crypto/otpauthUri';
import { parseXml } from '../src/import_export/xml';

const now = Date.UTC(2026, 8, 13, 12, 0, 0);

const sampleCredentials: CredentialItem[] = [
  {
    id: 'c1',
    vaultId: 'v1',
    title: 'GitHub <Enterprise> & Co',
    username: 'dev@bum.sh',
    password: 'p@ss "wörd" 🔐 avec espaces ',
    website: 'https://github.com',
    domain: 'github.com',
    totpSecret: 'JBSWY3DPEHPK3PXP',
    notes: 'Ligne 1\nLigne 2',
    fields: [{ id: 'f1', label: 'PIN', value: '4242', isMasked: true }],
    passkeys: [{
      credentialId: 'Y3JlZC1pZA',
      publicKey: '',
      privateKey: 'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg',
      signCount: 3,
      rpId: 'github.com',
      userName: 'dev@bum.sh',
      userHandle: 'dXNlcg',
      createdAt: now
    }],
    tags: ['Dev', 'Prod'],
    expiresAt: now + 86400000,
    createdAt: now,
    updatedAt: now
  },
  {
    id: 'c2',
    vaultId: 'v1',
    title: 'Serveur',
    username: 'root',
    password: 'Rt!2026',
    website: '',
    domain: '',
    tags: [],
    createdAt: now,
    updatedAt: now
  }
];

describe('Parseur XML minimal', () => {
  it('gère attributs, entités, CDATA et commentaires', () => {
    const root = parseXml('<?xml version="1.0"?><!-- c --><a x="1 &amp; 2"><b>t&lt;x&gt;&#233;</b><c/><d><![CDATA[<raw>]]></d></a>');
    const a = root.children[0];
    expect(a.attrs.x).toBe('1 & 2');
    expect(a.children[0].text).toBe('t<x>é');
    expect(a.children[2].text).toBe('<raw>');
  });

  it('rejette un document mal formé', () => {
    expect(() => parseXml('<a><b></a>')).toThrow();
  });
});

describe('KeePass KDBX 4 & XML', () => {
  it('écrit puis relit une base KDBX 4 (AES-KDF) avec valeurs protégées', async () => {
    const bytes = await buildKdbx4(sampleCredentials, 'maître-😀', { kdf: 'aes', aesRounds: 50 });
    const creds = await parseKdbx(bytes, 'maître-😀');

    expect(creds).toHaveLength(2);
    expect(creds[0].title).toBe('GitHub <Enterprise> & Co');
    expect(creds[0].password).toBe('p@ss "wörd" 🔐 avec espaces ');
    expect(creds[0].totpSecret).toBe('JBSWY3DPEHPK3PXP');
    expect(creds[0].notes).toBe('Ligne 1\nLigne 2');
    expect(creds[0].fields).toEqual([expect.objectContaining({ label: 'PIN', value: '4242', isMasked: true })]);
    expect(creds[0].passkeys?.[0]).toMatchObject({ rpId: 'github.com', credentialId: 'Y3JlZC1pZA', privateKey: sampleCredentials[0].passkeys![0].privateKey });
    expect(creds[0].tags).toEqual(['Dev', 'Prod']);
    expect(creds[0].createdAt).toBe(now);
    expect(creds[0].expiresAt).toBe(now + 86400000);
    expect(creds[1].password).toBe('Rt!2026');
  });

  it('écrit puis relit une base KDBX 4 (Argon2id)', async () => {
    const bytes = await buildKdbx4(sampleCredentials, 'secret', { argon2: { t: 1, m: 64, p: 1 } });
    const creds = await parseKdbx(bytes, 'secret');
    expect(creds[1].username).toBe('root');
  });

  it('refuse un mot de passe principal incorrect', async () => {
    const bytes = await buildKdbx4(sampleCredentials, 'bon', { kdf: 'aes', aesRounds: 10 });
    await expect(parseKdbx(bytes, 'mauvais')).rejects.toBeInstanceOf(KdbxError);
  });

  it('exige un mot de passe via le routeur d’import', async () => {
    const bytes = await buildKdbx4(sampleCredentials, 'bon', { kdf: 'aes', aesRounds: 10 });
    await expect(parseImportData(bytes, 'base.kdbx')).rejects.toBeInstanceOf(PasswordRequiredError);
    const result = await parseImportData(bytes, 'base.kdbx', { password: 'bon' });
    expect(result.sourceFormat).toBe('KeePass KDBX 4.0');
    expect(result.count).toBe(2);
  });

  it('parse un export KeePass XML avec groupes et corbeille', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<KeePassFile>
  <Meta><RecycleBinEnabled>True</RecycleBinEnabled><RecycleBinUUID>BIN==</RecycleBinUUID></Meta>
  <Root><Group><UUID>ROOT==</UUID><Name>Base</Name>
    <Group><UUID>G1==</UUID><Name>Banque</Name>
      <Entry>
        <Times><CreationTime>2024-05-01T10:00:00Z</CreationTime><Expires>False</Expires></Times>
        <String><Key>Title</Key><Value>Ma Banque</Value></String>
        <String><Key>UserName</Key><Value>client42</Value></String>
        <String><Key>Password</Key><Value ProtectInMemory="True">B@nk</Value></String>
        <String><Key>otp</Key><Value>otpauth://totp/Bank:client42?secret=JBSWY3DPEHPK3PXP&amp;period=60&amp;digits=8</Value></String>
        <String><Key>Code client</Key><Value>9981</Value></String>
        <History><Entry><String><Key>Title</Key><Value>Ancienne</Value></String></Entry></History>
      </Entry>
    </Group>
    <Group><UUID>BIN==</UUID><Name>Corbeille</Name>
      <Entry><String><Key>Title</Key><Value>Supprimée</Value></String></Entry>
    </Group>
  </Group></Root>
</KeePassFile>`;
    const creds = parseKeePassXml(xml);
    expect(creds).toHaveLength(1);
    expect(creds[0]).toMatchObject({ title: 'Ma Banque', username: 'client42', password: 'B@nk', tags: ['Banque'] });
    expect(creds[0].totpSecret).toMatch(/^otpauth:\/\/totp\/.*period=60/);
    expect(creds[0].fields?.[0]).toMatchObject({ label: 'Code client', value: '9981', isMasked: false });
    expect(creds[0].createdAt).toBe(Date.parse('2024-05-01T10:00:00Z'));
  });
});

describe('1Password 1PUX', () => {
  it('extrait identifiants, TOTP, champs et ignore les archivés', async () => {
    const exportData = {
      accounts: [{
        attrs: { name: 'Moi' },
        vaults: [{
          attrs: { name: 'Privé' },
          items: [
            {
              uuid: 'i1', favIndex: 1, createdAt: 1700000000, updatedAt: 1700000100, state: 'active', categoryUuid: '001',
              details: {
                loginFields: [
                  { value: 'alice', designation: 'username', fieldType: 'T' },
                  { value: 'S3cret!', designation: 'password', fieldType: 'P' }
                ],
                notesPlain: 'Note 1P',
                sections: [{ title: 'Sécurité', fields: [
                  { title: 'one-time password', value: { totp: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP' } },
                  { title: 'PIN', value: { concealed: '1234' } },
                  { title: 'Email secours', value: { email: { email_address: 'b@x.io' } } }
                ] }]
              },
              overview: { title: 'Dropbox', url: 'https://dropbox.com', tags: ['Cloud'] }
            },
            { uuid: 'i2', state: 'archived', details: {}, overview: { title: 'Vieux' } }
          ]
        }]
      }]
    };
    const bytes = zipSync({ 'export.attributes': strToU8('{}'), 'export.data': strToU8(JSON.stringify(exportData)) });
    const result = await parseImportData(bytes, 'moi.1pux');
    expect(result.sourceFormat).toBe('1Password 1PUX');
    expect(result.count).toBe(1);

    const [cred] = parse1pux(bytes);
    expect(cred).toMatchObject({ title: 'Dropbox', username: 'alice', password: 'S3cret!', website: 'https://dropbox.com', notes: 'Note 1P', isFavorite: true });
    expect(cred.totpSecret).toContain('JBSWY3DPEHPK3PXP');
    expect(cred.tags).toEqual(['Cloud', 'Privé']);
    expect(cred.fields?.map(f => [f.label, f.value, f.isMasked])).toEqual([['PIN', '1234', true], ['Email secours', 'b@x.io', false]]);
    expect(cred.createdAt).toBe(1700000000 * 1000);
  });
});

describe('FIDO CXF (Credential Exchange Format)', () => {
  it('exporte et réimporte identifiants, passkeys, TOTP, notes et champs', async () => {
    const json = exportCredentialsAsCxf(sampleCredentials);
    const doc = JSON.parse(json);
    expect(doc.version).toEqual({ major: 1, minor: 0 });
    expect(doc.accounts[0].items[0].credentials.map((c: any) => c.type)).toEqual(['basic-auth', 'passkey', 'totp', 'note', 'custom-fields']);

    const result = await parseImportData(new TextEncoder().encode(json), 'export.cxf.json');
    expect(result.sourceFormat).toBe('FIDO CXF (Credential Exchange)');

    const [cred] = parseCxf(doc);
    expect(cred).toMatchObject({ title: sampleCredentials[0].title, username: 'dev@bum.sh', password: sampleCredentials[0].password, totpSecret: 'JBSWY3DPEHPK3PXP', notes: 'Ligne 1\nLigne 2' });
    expect(cred.passkeys?.[0]).toMatchObject({ rpId: 'github.com', privateKey: sampleCredentials[0].passkeys![0].privateKey, userHandle: 'dXNlcg' });
    expect(cred.fields?.[0]).toMatchObject({ label: 'PIN', value: '4242', isMasked: true });
  });
});

describe('Export chiffré Argon2id + AES-256-GCM', () => {
  const params = { t: 1, m: 64, p: 1 };

  it('chiffre puis déchiffre un export', async () => {
    const file = await encryptExport('{"credentials":[]}', 'correct horse battery', params);
    expect(file).not.toContain('credentials');
    expect(await decryptExport(JSON.parse(file), 'correct horse battery')).toBe('{"credentials":[]}');
  });

  it('rejette un mauvais mot de passe et un en-tête altéré', async () => {
    const file = JSON.parse(await encryptExport('secret', 'correct horse battery', params));
    await expect(decryptExport(file, 'wrong horse battery')).rejects.toThrow('Mot de passe incorrect');
    await expect(decryptExport({ ...file, kdfParams: { t: 2, m: 64, p: 1 } }, 'correct horse battery')).rejects.toThrow();
    await expect(decryptExport({ ...file, kdfParams: { t: 1, m: 1 << 30, p: 1 } }, 'correct horse battery')).rejects.toThrow('Paramètres Argon2id invalides');
  });

  it('refuse un mot de passe trop court', async () => {
    await expect(encryptExport('x', 'court', params)).rejects.toThrow();
  });

  it('est reconnu et déchiffré par le routeur d’import', async () => {
    const inner = JSON.stringify({ generator: 'BetterVault', credentials: [{ title: 'A', password: 'b' }], tasks: [] });
    const bytes = new TextEncoder().encode(await encryptExport(inner, 'correct horse battery', params));
    await expect(parseImportData(bytes, 'backup.json')).rejects.toBeInstanceOf(PasswordRequiredError);
    const result = await parseImportData(bytes, 'backup.json', { password: 'correct horse battery' });
    expect(result.sourceFormat).toBe('BetterVault JSON — chiffré Argon2id');
    expect(result.credentials[0].title).toBe('A');
  });
});

describe('URI otpauth:// et normalisation 2FA', () => {
  it('parse une URI complète', () => {
    expect(parseOtpAuthUri('otpauth://totp/ACME%20Co:john@acme.io?secret=jbswy3dpehpk3pxp&issuer=ACME%20Co&digits=8&period=60&algorithm=SHA256')).toEqual({
      type: 'totp', secret: 'JBSWY3DPEHPK3PXP', issuer: 'ACME Co', account: 'john@acme.io', algorithm: 'SHA256', digits: 8, period: 60
    });
    expect(parseOtpAuthUri('otpauth://totp/x?secret=not-base32!')).toBeNull();
    expect(parseOtpAuthUri('https://example.com')).toBeNull();
  });

  it('normalise les différentes saisies', () => {
    expect(normalizeTotpInput('jbsw y3dp ehpk 3pxp')).toBe('JBSWY3DPEHPK3PXP');
    expect(normalizeTotpInput('otpauth://totp/a?secret=JBSWY3DPEHPK3PXP')).toBe('JBSWY3DPEHPK3PXP');
    expect(normalizeTotpInput('otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&digits=8')).toMatch(/^otpauth:\/\/totp\/.*digits=8/);
    expect(normalizeTotpInput('key=JBSWY3DPEHPK3PXP&step=30&size=6')).toBe('JBSWY3DPEHPK3PXP');
    expect(normalizeTotpInput('otpauth://hotp/a?secret=JBSWY3DPEHPK3PXP')).toBeNull();
    expect(normalizeTotpInput('secret invalide 0189!')).toBeNull();
  });
});

describe('Import CSV Dashlane / LastPass', () => {
  it('ne confond pas "username" avec le titre et lit la colonne "extra"', async () => {
    const dashlane = 'username,username2,username3,title,password,note,url,category,otpSecret\nbob,,,Netflix,N3tfl!x,,https://netflix.com,,\n';
    const d = await parseImportData(new TextEncoder().encode(dashlane), 'dashlane.csv');
    expect(d.credentials[0]).toMatchObject({ title: 'Netflix', username: 'bob' });

    const lastpass = 'url,username,password,totp,extra,name,grouping,fav\nhttps://x.io,al,pw,,Note LP,X,,0\n';
    const l = await parseImportData(new TextEncoder().encode(lastpass), 'lastpass.csv');
    expect(l.credentials[0]).toMatchObject({ title: 'X', username: 'al', notes: 'Note LP' });
  });
});
