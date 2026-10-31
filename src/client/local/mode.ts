export type LocalCapabilities = {
  local: boolean;
  pdf: boolean;
  uploads: boolean;
  identity: boolean;
  members: boolean;
  polyHaven: boolean;
  brandingAdmin: boolean;
  packages: boolean;
};

const fullCapabilities: LocalCapabilities = {
  local: false,
  pdf: true,
  uploads: true,
  identity: true,
  members: true,
  polyHaven: true,
  brandingAdmin: true,
  packages: true,
};

const demoCapabilities: LocalCapabilities = {
  local: true,
  pdf: false,
  uploads: false,
  identity: false,
  members: false,
  polyHaven: false,
  brandingAdmin: false,
  packages: false,
};

export function isLocalMode(): boolean {
  const value = import.meta.env.VITE_LOCAL_MODE;
  return value === '1' || value === 'true';
}

export const localCapabilities: LocalCapabilities = isLocalMode() ? demoCapabilities : fullCapabilities;
