/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';

import { POST as completeOidcRegister } from '@/app/api/auth/oidc/complete-register/route';
import { POST as registerUser } from '@/app/api/register/route';
import { GET as verifyTelegramLogin } from '@/app/api/telegram/verify/route';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { verifyAndConsumeTelegramToken } from '@/lib/telegram-tokens';

jest.mock('@/lib/config', () => ({
  clearConfigCache: jest.fn(),
  getConfig: jest.fn(),
}));

jest.mock('@/lib/db', () => ({
  db: {
    checkUserExist: jest.fn(),
    checkUserExistV2: jest.fn(),
    createUserV2: jest.fn(),
    getAdminConfig: jest.fn(),
    getUserByOidcSub: jest.fn(),
    registerUser: jest.fn(),
    updateUserLoginStats: jest.fn(),
  },
}));

jest.mock('@/lib/invite-code', () => ({
  useInviteCode: jest.fn(),
  validateInviteCode: jest.fn(),
}));

jest.mock('@/lib/telegram-tokens', () => ({
  getTelegramToken: jest.fn(),
  verifyAndConsumeTelegramToken: jest.fn(),
}));

describe('public registration is disabled', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'redis';
    process.env.USERNAME = 'owner';
    process.env.PASSWORD = 'secret';

    (getConfig as jest.Mock).mockResolvedValue({
      OIDCAuthConfig: {
        enabled: true,
        enableRegistration: true,
      },
      OIDCProviders: [],
      SiteConfig: {},
      UserConfig: {
        AllowRegister: true,
        RequireInviteCode: false,
        Users: [],
      },
    });
  });

  it('rejects regular registration before creating a user', async () => {
    const request = new NextRequest('http://localhost/api/register', {
      method: 'POST',
      body: JSON.stringify({
        username: 'new_user',
        password: 'password1',
        confirmPassword: 'password1',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await registerUser(request);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('注册功能已禁用');
    expect(db.registerUser).not.toHaveBeenCalled();
    expect(db.createUserV2).not.toHaveBeenCalled();
  });

  it('rejects OIDC registration before creating a user', async () => {
    const request = new NextRequest('http://localhost/api/auth/oidc/complete-register', {
      method: 'POST',
      body: JSON.stringify({ username: 'oidc_user' }),
      headers: {
        'Content-Type': 'application/json',
        Cookie: `oidc_session=${encodeURIComponent(JSON.stringify({
          sub: 'oidc-sub',
          providerId: 'default',
          timestamp: Date.now(),
        }))}`,
      },
    });

    const response = await completeOidcRegister(request);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('注册功能已禁用');
    expect(db.createUserV2).not.toHaveBeenCalled();
  });

  it('does not auto-register new Telegram users', async () => {
    (verifyAndConsumeTelegramToken as jest.Mock).mockResolvedValue({
      telegramUsername: 'brand_new',
    });
    (db.getAdminConfig as jest.Mock).mockResolvedValue({
      TelegramAuthConfig: {
        enabled: true,
        autoRegister: true,
      },
    });
    (db.checkUserExist as jest.Mock).mockResolvedValue(false);

    const response = await verifyTelegramLogin(
      new Request('http://localhost/api/telegram/verify?token=test-token&confirm=1')
    );
    const html = await response.text();

    expect(response.status).toBe(404);
    expect(html).toContain('用户不存在');
    expect(db.registerUser).not.toHaveBeenCalled();
  });
});
