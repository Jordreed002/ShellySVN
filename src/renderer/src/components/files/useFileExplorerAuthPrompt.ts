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
      .getStatus(realm)
      .then((status) => {
        if (status.available && status.username) {
          setUsername(status.username);
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
    // A password is mandatory: persisting an empty one would overwrite a good
    // saved credential with something that can never authenticate.
    if (!username || !password || !realm) return;

    try {
      await window.api.auth.beginSession({
        realm,
        username,
        password,
        persistence: 'stored',
      });
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
