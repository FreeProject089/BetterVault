/** Sous-ensemble typé des API d'extension utilisées par BetterVault (Chrome, Edge, Firefox MV3) */
declare namespace chrome {
  namespace tabs {
    interface Tab {
      id?: number;
      url?: string;
    }
    function query(queryInfo: { active: boolean; currentWindow: boolean }): Promise<Tab[]>;
    function create(properties: { url: string }): Promise<Tab>;
  }

  namespace storage {
    const session: {
      get(key: string): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(key: string): Promise<void>;
    } | undefined;
  }

  namespace runtime {
    function getURL(path: string): string;
  }

  namespace scripting {
    interface InjectionResult<T> {
      result?: T;
    }
    function executeScript<Args extends unknown[], Result>(injection: {
      target: { tabId: number };
      func: (...args: Args) => Result;
      args: Args;
    }): Promise<InjectionResult<Result>[]>;
  }
}
