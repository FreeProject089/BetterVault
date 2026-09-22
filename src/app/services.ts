import type { AccountService } from '../account/accountService';
import type { SharedVaultManager } from '../account/sharedVaults';

/**
 * Services de compte partagés par les écrans sortis de main.ts. Ils sont créés au
 * démarrage (fin de main.ts), une fois le stockage de l'appareil chargé, puis
 * enregistrés ici : les modules lisent toujours l'instance courante.
 */
export let accountService: AccountService;
export let sharedVaults: SharedVaultManager;

export function registerServices(account: AccountService, shared: SharedVaultManager): void {
  accountService = account;
  sharedVaults = shared;
}
