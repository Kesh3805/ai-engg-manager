'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserCircle, LogOut, LogIn } from 'lucide-react';
import { GlassPanel } from '@/components/ui/glass-panel';
import { Button } from '@/components/ui/button';
import { signOut } from '@/lib/auth-client';

interface Me {
  user: { id: string; name: string | null; email: string | null; image: string | null } | null;
  org: { id: string; name: string } | null;
}

/** Profile — session identity + workspace (nav-rail target). */
export default function ProfilePage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    fetch('/api/v1/me')
      .then((r) => r.json())
      .then(setMe)
      .catch(() => setMe({ user: null, org: null }));
  }, []);

  return (
    <div className="flex h-full items-center justify-center px-24">
      <GlassPanel noHover className="w-full max-w-md p-6 text-center">
        {me?.user?.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={me.user.image} alt="" className="mx-auto h-16 w-16 rounded-full ring-2 ring-arc-400/60" />
        ) : (
          <UserCircle className="mx-auto h-16 w-16 text-muted-foreground" />
        )}
        <h1 className="font-display mt-3 text-lg font-semibold">{me?.user?.name ?? 'Not signed in'}</h1>
        <p className="text-sm text-muted-foreground">{me?.user?.email ?? 'Sign in with GitHub to persist conversations and org data.'}</p>
        {me?.org && <p className="mt-1 font-mono text-xs text-arc-300">{me.org.name}</p>}

        <div className="mt-5">
          {me?.user ? (
            <Button
              variant="secondary"
              onClick={() => signOut().then(() => router.push('/app'))}
            >
              <LogOut className="h-4 w-4" /> Sign out
            </Button>
          ) : (
            <Button onClick={() => router.push('/auth/login')}>
              <LogIn className="h-4 w-4" /> Sign in
            </Button>
          )}
        </div>
      </GlassPanel>
    </div>
  );
}
