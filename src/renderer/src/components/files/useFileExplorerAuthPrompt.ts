import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export function useFileExplorerAuthPrompt() {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [realm, setRealm] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (!isOpen || !realm) return;

    window.api.auth
      .get(realm)
      .then((savedCreds) => {
        if (savedCreds) {
          setUsername(savedCreds.username);
          setPassword(savedCreds.password);
        }
      })
      .catch(() => {
        // Saved credentials are optional; the user can still enter them manually.
      });
  }, [isOpen, realm]);

  const requestAuthentication = useCallback((nextRealm: string) => {
    setRealm(nextRealm);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const submit = useCallback(async () => {
    if (!username || !realm) return;

    try {
      await window.api.auth.set(realm, username, password);
      queryClient.invalidateQueries({ queryKey: ['auth', realm] });
      setIsOpen(false);
      setUsername('');
      setPassword('');
    } catch {}
  }, [username, password, realm, queryClient]);

  return {
    isOpen,
    realm,
    username,
    password,
    setUsername,
    setPassword,
    requestAuthentication,
    close,
    submit,
  };
}
