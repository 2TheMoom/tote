/** True for phone and tablet user agents, where no wallet extension can be installed. */
export function isMobileUserAgent(userAgent: string): boolean {
  return /Android|iPhone|iPad|iPod/i.test(userAgent);
}

/**
 * Deep link that reopens this page inside MetaMask's mobile browser, where a
 * wallet is injected. MetaMask's format is dapp/<host><path>, no protocol.
 */
export function metamaskAppLink(host: string, pathname: string): string {
  const path = pathname && pathname !== "/" ? pathname : "";
  return `https://metamask.app.link/dapp/${host}${path}`;
}
