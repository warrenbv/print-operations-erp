// Pallet and footage words for the Lines step summary and the price approval card.
import { palletsText, rollsPerPalletText } from '@erp/types';

import { formatFeet } from './measures';

export function palletSentence(pallets: number | null): string {
  return pallets === null ? 'Pallets not counted.' : `${palletsText(pallets)}.`;
}

export function footageUsed(feetPerRoll: string, rollsPerPallet: number | null): string {
  return `${formatFeet(feetPerRoll)} ft · ${rollsPerPalletText(rollsPerPallet)}`;
}
