import {
  addHomeLoginTransition,
  HOME_LOGIN_TRANSITION_PARAM,
  isHomeLoginTransition,
} from '@/lib/home-loading-transition';

describe('home loading transition', () => {
  it('marks only home redirects as explicit login transitions', () => {
    expect(addHomeLoginTransition('/')).toBe('/?loginTransition=1');
    expect(addHomeLoginTransition('/?tab=home')).toBe(
      '/?tab=home&loginTransition=1'
    );
    expect(addHomeLoginTransition('/play?id=1')).toBe('/play?id=1');
    expect(addHomeLoginTransition('https://example.com/')).toBe(
      'https://example.com/'
    );
  });

  it('recognizes the one-time transition marker', () => {
    expect(HOME_LOGIN_TRANSITION_PARAM).toBe('loginTransition');
    expect(isHomeLoginTransition('1')).toBe(true);
    expect(isHomeLoginTransition(['0', '1'])).toBe(true);
    expect(isHomeLoginTransition(undefined)).toBe(false);
    expect(isHomeLoginTransition('0')).toBe(false);
  });
});
