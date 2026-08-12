import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import LoginPage from '@/app/login/page';
import { UserMenu } from '@/components/UserMenu';

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
  }),
  useSearchParams: () => ({
    get: jest.fn(() => null),
  }),
}));

jest.mock('@/components/SiteProvider', () => ({
  useSite: () => ({ siteName: 'LunaTV' }),
}));

jest.mock('@/components/ThemeToggle', () => ({
  ThemeToggle: () => <button type="button">Theme</button>,
}));

jest.mock('@/components/OIDCProviderLogos', () => ({
  OIDCProviderLogo: () => <span />,
  detectProvider: () => 'google',
  getProviderButtonStyle: () => '',
  getProviderButtonText: () => 'OIDC',
}));

jest.mock('@/lib/version_check', () => ({
  UpdateStatus: {
    HAS_UPDATE: 'has_update',
    NO_UPDATE: 'no_update',
    FETCH_FAILED: 'fetch_failed',
  },
  checkForUpdates: jest.fn(async () => 'no_update'),
}));

jest.mock('@/contexts/DownloadContext', () => ({
  useDownload: () => ({
    tasks: [],
    setShowDownloadPanel: jest.fn(),
  }),
}));

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromBrowserCookie: () => ({
    username: 'admin',
    role: 'owner',
  }),
}));

jest.mock('@/components/SettingsPanel', () => ({
  SettingsPanel: () => null,
}));

jest.mock('@/components/VideoCard', () => ({
  __esModule: true,
  default: () => <div />,
}));

jest.mock('@/hooks/useUserMenuQueries', () => ({
  useWatchRoomConfigQuery: () => ({ data: false }),
  useServerConfigQuery: () => ({ data: { downloadEnabled: false } }),
  usePlayRecordsQuery: () => ({ data: [] }),
  useFavoritesQuery: () => ({ data: [] }),
  useChangePasswordMutation: () => ({ mutate: jest.fn() }),
  useInvalidateUserMenuData: () => ({ invalidatePlayRecords: jest.fn() }),
}));

jest.mock('@/hooks/useWatchingUpdates', () => ({
  useWatchingUpdatesQuery: () => ({
    data: {
      updatedCount: 0,
      updatedSeries: [],
    },
  }),
  useRefreshWatchingUpdates: () => jest.fn(),
}));

describe('auth UI hiding', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock | undefined) = jest.fn(async (url: string) => {
      if (url === '/api/server-config') {
        return {
          json: async () => ({
            TelegramAuthConfig: { enabled: false },
            OIDCConfig: { enabled: false },
            OIDCProviders: [],
          }),
        } as Response;
      }

      return {
        json: async () => ({}),
      } as Response;
    });

    Object.defineProperty(window, 'RUNTIME_CONFIG', {
      value: { STORAGE_TYPE: 'redis' },
      configurable: true,
    });
  });

  it('does not render the registration entry on the login page', async () => {
    render(<LoginPage />);

    await waitFor(() => {
      expect(screen.getByText('立即登录')).toBeInTheDocument();
    });

    expect(screen.queryByRole('link', { name: /立即注册/ })).not.toBeInTheDocument();
    expect(screen.queryByText('还没有账户？')).not.toBeInTheDocument();
    expect(screen.queryByText('v6.6.2')).not.toBeInTheDocument();
  });

  it('does not render version information in the logged-in user menu', async () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <UserMenu />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByLabelText('User Menu'));

    await waitFor(() => {
      expect(screen.getByText('当前用户')).toBeInTheDocument();
    });

    expect(screen.queryByText('v6.6.2')).not.toBeInTheDocument();
    expect(screen.queryByText('版本信息')).not.toBeInTheDocument();
  });
});
