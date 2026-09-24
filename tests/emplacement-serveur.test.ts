import { describe, it, expect } from 'vitest';
import { addressKind, parsePlace } from '../server/src/serverPlace.ts';

/**
 * Carte des serveurs : l'emplacement réglé par l'hébergeur, et les adresses
 * dont la géolocalisation ne dirait rien de vrai (relais, réseau local).
 */

describe('Emplacement d’un serveur', () => {
  it('garde une position valide, arrondie, avec un libellé nettoyé', () => {
    expect(parsePlace({ lat: 46.20391, lon: 6.14316, label: '  Genève <b>  ' })).toEqual({ lat: 46.204, lon: 6.143, label: 'Genève b' });
    expect(parsePlace({ lat: '48.86', lon: '2.35' })).toEqual({ lat: 48.86, lon: 2.35, label: '' });
  });

  it('refuse une position hors de la Terre ou incomplète', () => {
    for (const bad of [null, {}, { lat: 91, lon: 0 }, { lat: 0, lon: -181 }, { lat: 'nord', lon: 2 }, { lat: Infinity, lon: 0 }]) {
      expect(parsePlace(bad)).toBeNull();
    }
  });
});

describe('Adresses qui ne disent pas où est le serveur', () => {
  it('reconnaît les relais Cloudflare, en IPv4 comme en IPv6', () => {
    expect(addressKind('104.21.32.1')).toBe('proxy');
    expect(addressKind('172.67.10.10')).toBe('proxy');
    expect(addressKind('2606:4700:3033::6815:2001')).toBe('proxy');
  });

  it('reconnaît les adresses locales', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.20', '172.20.0.5', '::1', 'fd12:3456::1', '::ffff:192.168.0.1']) {
      expect(addressKind(ip)).toBe('local');
    }
  });

  it('laisse géolocaliser une adresse publique ordinaire', () => {
    expect(addressKind('51.38.10.20')).toBeNull();
    expect(addressKind('2001:41d0:8:1234::1')).toBeNull();
    expect(addressKind('pas-une-adresse')).toBeNull();
  });
});
