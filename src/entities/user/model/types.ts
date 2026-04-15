export interface AuthUser {
  id: string;
  name: string;
  email: string;
  createdAt: number;
}

export interface PublicConfig {
  auth: {
    allowRegistration: boolean;
  };
}
