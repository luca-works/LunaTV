export const HOME_LOGIN_TRANSITION_PARAM = 'loginTransition';

export function addHomeLoginTransition(path: string): string {
  const url = new URL(path, 'http://lunatv.local');

  if (url.origin !== 'http://lunatv.local' || url.pathname !== '/') {
    return path;
  }

  url.searchParams.set(HOME_LOGIN_TRANSITION_PARAM, '1');
  return `${url.pathname}${url.search}${url.hash}`;
}

export function isHomeLoginTransition(value: string | string[] | undefined): boolean {
  return value === '1' || (Array.isArray(value) && value.includes('1'));
}
