import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { StaleBanner } from './StaleBanner';

afterEach(cleanup);

describe('StaleBanner', () => {
  it('rien quand les données sont fraîches', () => {
    const { container } = render(<StaleBanner data={{ stale: false, lastSyncOk: '2026-10-25T05:00:00Z', asOf: '2026-10-25' }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('date de la dernière synchro au jour de Paris (23:30 UTC = lendemain), format long', () => {
    render(<StaleBanner data={{ stale: true, lastSyncOk: '2026-10-24T23:30:00.000Z', asOf: '2026-10-27' }} />);
    expect(screen.getByRole('status')).toHaveTextContent(/^Données du 25 octobre 2026$/);
  });

  it('retombe sur asOf si lastSyncOk est absent ou invalide', () => {
    render(<StaleBanner data={{ stale: true, lastSyncOk: 'pas une date', asOf: '2026-10-20' }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Données du 20 octobre 2026');
    cleanup();
    render(<StaleBanner data={{ stale: true, lastSyncOk: null, asOf: '2026-11-01' }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Données du 1 novembre 2026');
  });
});
