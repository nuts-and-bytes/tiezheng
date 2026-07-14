/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  /** Umami 站点 ID。不设 = 埋点整个哑掉（dev/test 零网络请求）。它不是密钥，本来就要进客户端包 */
  readonly VITE_UMAMI_WEBSITE_ID?: string;
  /** 自托管时覆盖脚本地址；不设走云版 */
  readonly VITE_UMAMI_SRC?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
