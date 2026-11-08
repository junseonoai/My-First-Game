import type * as React from 'react';
export type Suit = 'heart' | 'diamond' | 'spade' | 'club' | 'joker';
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: 'primary' | 'secondary' | 'ghost' | 'call'; size?: 'sm' | 'md' | 'lg'; icon?: React.ReactNode }
export declare function Button(props: ButtonProps): React.ReactElement;
export interface PlayingCardProps { hint?: 'counter' | 'block' | 'joker'; rank?: string; suit?: Suit; faceDown?: boolean; state?: 'normal' | 'playable' | 'selected' | 'disabled'; attack?: boolean; size?: 'sm' | 'md'; onClick?: () => void }
export declare function PlayingCard(props: PlayingCardProps): React.ReactElement;
export interface RoomCodeProps { code: string; label?: string; onCopy?: (code: string) => void }
export declare function RoomCode(props: RoomCodeProps): React.ReactElement;
export type Tier = 'silver' | 'gold' | 'platinum' | 'master' | 'grandmaster';
export interface PlayerChipProps { name: string; cards: number; tier?: Tier; active?: boolean; next?: boolean; oneCard?: boolean; offline?: boolean; host?: boolean; me?: boolean }
export declare function PlayerChip(props: PlayerChipProps): React.ReactElement;
export interface TurnTimerProps { seconds: number; total?: number; label?: string; waiting?: boolean }
export declare function TurnTimer(props: TurnTimerProps): React.ReactElement;
export interface CallBannerProps { kind?: 'onecard' | 'attack' | 'win'; title?: string; detail?: string; amount?: number }
export declare function CallBanner(props: CallBannerProps): React.ReactElement;
export interface TextFieldProps extends React.InputHTMLAttributes<HTMLInputElement> { label: string; hint?: string; error?: string; code?: boolean }
export declare function TextField(props: TextFieldProps): React.ReactElement;
export interface BadgeProps { tone?: 'neutral' | 'brand' | 'seal' | 'felt' | 'call' | Tier; children?: React.ReactNode }
export declare function Badge(props: BadgeProps): React.ReactElement;
export interface QuickChatProps { phrases?: string[]; onSend?: (text: string) => void }
export declare function QuickChat(props: QuickChatProps): React.ReactElement;
declare global { interface Window { Hanjang: { Button: typeof Button; PlayingCard: typeof PlayingCard; RoomCode: typeof RoomCode; PlayerChip: typeof PlayerChip; TurnTimer: typeof TurnTimer; CallBanner: typeof CallBanner; TextField: typeof TextField; Badge: typeof Badge; QuickChat: typeof QuickChat } } }
