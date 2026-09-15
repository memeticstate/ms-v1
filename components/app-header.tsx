"use client";

import Link from 'next/link';
import { useState } from 'react';
import { useTheme } from 'next-themes';
import { ArrowUpRight, Bookmark, Compass, MessageSquare, Moon, Radio, Sun, Wallet } from 'lucide-react';
import { StateGlyph } from './state-glyph';
import { useMemeticAuth } from './memetic-auth-provider';
import type { PassportResponse } from '@/lib/entitlements/client';
import styles from './simple-experience.module.css';

const destinations = [
  { id: 'now', title: 'Now', href: '/app', icon: Radio },
  { id: 'observe', title: 'Observe', href: '/app/observe', icon: Compass },
  { id: 'research', title: 'Research', href: '/app/research', icon: MessageSquare },
  { id: 'saved', title: 'Saved', href: '/app/saved', icon: Bookmark },
] as const;

export function AppHeader({ active = 'now', passport = null, onAccount }: {
  active?: 'now' | 'observe' | 'research' | 'saved'; passport?: PassportResponse | null; onAccount?: () => void;
}) {
  const { ready, authenticated, signIn, signOut, linkWallet, loginState } = useMemeticAuth();
  const { resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const wallet = passport?.authenticated && passport.authProvider === 'privy' ? passport.wallets.find(w => w.primary) ?? passport.wallets[0] : null;
  return <>
    <header className={styles.header}>
      <Link href="/app" className={styles.brand} aria-label="Memetic State home">
        <StateGlyph className={styles.brandMark} />
        <span>MEMETIC <em>State</em></span>
      </Link>
      <nav className={styles.desktopNav} aria-label="Main navigation">
        {destinations.map(item => <Link key={item.id} href={item.href} aria-current={active === item.id ? 'page' : undefined}>{item.title}</Link>)}
      </nav>
      <div className={styles.headerActions}>
        <button className={styles.iconButton} aria-label="Toggle light and dark theme" onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}><Sun size={17} className={styles.sunIcon} /><Moon size={17} className={styles.moonIcon} /></button>
        <div className={styles.walletWrap}>
          <button className={styles.walletButton} disabled={!ready} onClick={() => authenticated ? setOpen(!open) : signIn()} aria-expanded={authenticated ? open : undefined}><Wallet size={16} /><span>{authenticated ? wallet ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}` : 'Account' : loginState === 'pending' ? 'Connecting…' : 'Wallet'}</span></button>
          {open && authenticated ? <div className={styles.accountMenu}>
            <button onClick={() => { linkWallet(); setOpen(false); }}>Link holder wallet</button>
            {onAccount ? <button onClick={() => { onAccount(); setOpen(false); }}>Account & access</button> : <Link href="/app/observe?view=network" onClick={() => setOpen(false)}>Account & access <ArrowUpRight size={14} /></Link>}
            <button onClick={() => { void signOut(); setOpen(false); }}>Sign out</button>
          </div> : null}
        </div>
      </div>
    </header>
    <nav className={styles.mobileNav} aria-label="Mobile navigation">
      {destinations.map(item => <Link key={item.id} href={item.href} aria-current={active === item.id ? 'page' : undefined}><item.icon size={18} /><span>{item.title}</span></Link>)}
    </nav>
  </>;
}
