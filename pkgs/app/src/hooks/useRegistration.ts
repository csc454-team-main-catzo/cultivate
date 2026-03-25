import { useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { useApi } from '../providers/apiContext';
import { useUser } from '../providers/userContext';

/**
 * Hook for user registration
 * Separates registration logic from user context
 */
export function useRegistration() {
  const { isAuthenticated, user: authUser } = useAuth0();
  const { users } = useApi();
  const { refreshUser } = useUser();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const register = async (role: 'farmer' | 'restaurant', postalCode: string) => {
    if (!isAuthenticated) {
      throw new Error('Must be authenticated to register');
    }

    setIsLoading(true);
    setError(null);

    try {
      const registerPayload = {
        role,
        postalCode,
        ...(authUser?.email && { email: authUser.email }),
        ...(authUser?.name && { name: authUser.name }),
      };
      await users.registerUser({
        registerUserRequest: registerPayload,
      });
      // Refresh user data after registration
      await refreshUser();
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to register user');
      setError(error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  return { register, isLoading, error };
}
