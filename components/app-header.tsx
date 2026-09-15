"use client";

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { ArrowUpRight, Bookmark, ChevronDown, Compass, LogOut, MessageSquare, Moon, Plus, Radio, ShieldCheck, Sun, Wallet } from 'lucide-react';
import { StateGlyph } from './state-glyph';
import { useMemeticAuth } from './memetic-auth-provider';
import type { PassportResponse } from '@/lib/entitlements/client';
import styles from './app-header.module.css';

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
  const accountId = useId();
  const walletWrap = useRef<HTMLDivElement>(null);
  const walletTrigger = useRef<HTMLButtonElement>(null);
  const wallet = passport?.authenticated && passport.authProvider === 'privy' ? passport.wallets.find(w => w.primary) ?? passport.wallets[0] : null;
  const walletLabel = authenticated ? wallet ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}` : 'Account' : loginState === 'pending' ? 'Connecting…' : 'Connect wallet';

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !walletWrap.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false); walletTrigger.current?.focus();
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeOnEscape); };
  }, [open]);

  return <>
    <header className={styles.header}>
      <Link href="/app" className={styles.brand} aria-label="Memetic State home">
        <span className={styles.brandSymbol}><StateGlyph className={styles.brandMark} /></span>
        <span className={styles.wordmark}>Memetic <span>State</span></span>
      </Link>
      <nav className={styles.desktopNav} aria-label="Main navigation">
        {destinations.map(item => <Link key={item.id} href={item.href} aria-label={item.title} title={item.title} aria-current={active === item.id ? 'page' : undefined}><item.icon size={16} strokeWidth={1.8} aria-hidden="true" /><span>{item.title}</span></Link>)}
      </nav>
      <div className={styles.headerActions}>
        <button type="button" className={styles.iconButton} aria-label="Toggle light and dark theme" title="Switch appearance" onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}><Sun size={18} strokeWidth={1.7} className={styles.sunIcon} aria-hidden="true" /><Moon size={18} strokeWidth={1.7} className={styles.moonIcon} aria-hidden="true" /></button>
        <div className={styles.walletWrap} ref={walletWrap}>
          <button type="button" ref={walletTrigger} className={styles.walletButton} data-authenticated={authenticated} disabled={!ready} onClick={() => authenticated ? setOpen(!open) : signIn()} aria-label={authenticated ? 'Open account options' : loginState === 'pending' ? 'Connecting wallet' : 'Connect wallet'} aria-expanded={authenticated ? open : undefined} aria-controls={open && authenticated ? accountId : undefined}><Wallet size={16} strokeWidth={1.8} aria-hidden="true" /><span className={styles.desktopWalletLabel}>{walletLabel}</span><span className={styles.mobileWalletLabel}>{authenticated ? 'Account' : loginState === 'pending' ? 'Connecting…' : 'Wallet'}</span>{authenticated ? <ChevronDown size={13} strokeWidth={1.8} className={styles.walletChevron} aria-hidden="true" /> : null}</button>
          {open && authenticated ? <div id={accountId} className={styles.accountMenu} role="group" aria-label="Account actions">
            <div className={styles.accountHeading}><span className={styles.accountDot} /><span>{wallet ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}` : 'Your account'}</span></div>
            <button type="button" onClick={() => { linkWallet(); setOpen(false); }}><Plus size={16} aria-hidden="true" /><span>Link holder wallet</span></button>
            {onAccount ? <button type="button" onClick={() => { onAccount(); setOpen(false); }}><ShieldCheck size={16} aria-hidden="true" /><span>Account & access</span></button> : <Link href="/app/observe?view=network" onClick={() => setOpen(false)}><ShieldCheck size={16} aria-hidden="true" /><span>Account & access</span><ArrowUpRight size={14} aria-hidden="true" /></Link>}
            <button type="button" className={styles.signOut} onClick={() => { void signOut(); setOpen(false); }}><LogOut size={16} aria-hidden="true" /><span>Sign out</span></button>
          </div> : null}
        </div>
      </div>
    </header>
    <nav className={styles.mobileNav} aria-label="Mobile navigation">
      {destinations.map(item => <Link key={item.id} href={item.href} aria-current={active === item.id ? 'page' : undefined}><item.icon size={20} strokeWidth={1.8} aria-hidden="true" /><span>{item.title}</span></Link>)}
    </nav>
  </>;
}
