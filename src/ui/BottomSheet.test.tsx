import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BottomSheet } from './BottomSheet';

function Harness({ footer, children }: { footer?: ReactNode; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Ouvrir</button>
      <BottomSheet open={open} title="Ajouter un actif" onClose={() => setOpen(false)} footer={footer}>
        {children ?? (
          <>
            <label>Nom <input type="text" /></label>
            <label>Note <input type="text" /></label>
            <button type="button" onClick={() => setOpen(false)}>Annuler</button>
          </>
        )}
      </BottomSheet>
    </>
  );
}

afterEach(cleanup);

const opener = () => screen.getByRole('button', { name: 'Ouvrir' });

describe('BottomSheet', () => {
  it('ne rend rien quand il est fermé', () => {
    const { container } = render(<BottomSheet open={false} title="T" onClose={() => {}}>contenu</BottomSheet>);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('est un dialogue modal étiqueté par son titre', () => {
    render(<BottomSheet open title="Ajouter un actif" onClose={() => {}}>contenu</BottomSheet>);
    const dialog = screen.getByRole('dialog', { name: 'Ajouter un actif' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const labelId = dialog.getAttribute('aria-labelledby')!;
    expect(document.getElementById(labelId)).toHaveTextContent('Ajouter un actif');
    expect(screen.getByText('contenu')).toBeInTheDocument();
  });

  it('affiche le pied de feuille et limite la hauteur à 90dvh avec défilement interne', () => {
    render(<BottomSheet open title="T" onClose={() => {}} footer={<button type="button">Enregistrer</button>}>x</BottomSheet>);
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeInTheDocument();
    expect(screen.getByRole('dialog').className).toMatch(/max-h-\[90dvh\]/);
  });

  it("donne le focus au dialogue à l'ouverture", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(opener());
    expect(screen.getByRole('dialog')).toHaveFocus();
  });

  it("rend le focus à l'élément d'origine après Échap, bouton et clic sur le fond", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(opener());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener()).toHaveFocus();

    await user.click(opener());
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener()).toHaveFocus();

    await user.click(opener());
    await user.click(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener()).toHaveFocus();
  });

  it('un clic dans le dialogue ne le ferme pas', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(opener());
    await user.click(screen.getByRole('heading', { name: 'Ajouter un actif' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('une sélection de texte qui finit sur le fond ne ferme pas la feuille', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(opener());
    const input = screen.getByLabelText('Nom');
    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement;
    await user.pointer([{ keys: '[MouseLeft>]', target: input }, { target: backdrop }, { keys: '[/MouseLeft]' }]);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it("ne plante pas si l'élément d'origine a disparu du document à la fermeture", async () => {
    const user = userEvent.setup();
    function Vanishing() {
      const [open, setOpen] = useState(false);
      const [showOpener, setShowOpener] = useState(true);
      return (
        <>
          {showOpener && <button type="button" onClick={() => setOpen(true)}>Ouvrir</button>}
          <BottomSheet open={open} title="T" onClose={() => { setShowOpener(false); setOpen(false); }}>
            <button type="button">Dedans</button>
          </BottomSheet>
        </>
      );
    }
    render(<Vanishing />);
    await user.click(opener());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ouvrir' })).toBeNull();
  });

  it('Tab et Maj+Tab bouclent dans le dialogue', async () => {
    const user = userEvent.setup();
    render(<Harness footer={<button type="button">Enregistrer</button>} />);
    await user.click(opener());
    const dialog = screen.getByRole('dialog');
    const first = within(dialog).getByLabelText('Nom');
    const last = within(dialog).getByRole('button', { name: 'Enregistrer' });

    last.focus();
    await user.tab();
    expect(first).toHaveFocus();
    await user.tab({ shift: true });
    expect(last).toHaveFocus();

    // Depuis le dialogue lui-même, Maj+Tab va au dernier élément.
    dialog.focus();
    await user.tab({ shift: true });
    expect(last).toHaveFocus();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it('Tab depuis le focus initial reste dans la feuille', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(opener());
    await user.tab();
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
    expect(document.activeElement).not.toBe(opener());
  });

  it('ignore les éléments désactivés dans la boucle de tabulation', async () => {
    const user = userEvent.setup();
    render(<Harness footer={<button type="button" disabled>Enregistrer</button>} />);
    await user.click(opener());
    const dialog = screen.getByRole('dialog');
    within(dialog).getByRole('button', { name: 'Annuler' }).focus();
    await user.tab();
    expect(within(dialog).getByLabelText('Nom')).toHaveFocus();
  });

  it("appelle le dernier onClose reçu (ref) sans réinstaller l'écouteur", async () => {
    const user = userEvent.setup();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<BottomSheet open title="T" onClose={first}>x</BottomSheet>);
    rerender(<BottomSheet open title="T" onClose={second}>x</BottomSheet>);
    await user.keyboard('{Escape}');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('Échap sans feuille ouverte ne déclenche rien', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<BottomSheet open={false} title="T" onClose={onClose}>x</BottomSheet>);
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('un re-rendu du parent ne vole pas le focus du champ en cours de saisie', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<BottomSheet open title="T" onClose={() => {}}><input aria-label="Montant" /></BottomSheet>);
    const input = screen.getByLabelText('Montant');
    await user.click(input);
    expect(input).toHaveFocus();
    rerender(<BottomSheet open title="T" onClose={() => {}}><input aria-label="Montant" /></BottomSheet>);
    expect(input).toHaveFocus();
  });

  it("bloque le défilement du body pendant l'ouverture et le rétablit à la fermeture", async () => {
    const user = userEvent.setup();
    document.body.style.overflow = 'auto';
    render(<Harness />);
    await user.click(opener());
    expect(document.body.style.overflow).toBe('hidden');
    await user.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('auto');
  });

  it('rétablit le défilement du body au démontage', () => {
    document.body.style.overflow = '';
    const { unmount } = render(<BottomSheet open title="T" onClose={() => {}}>x</BottomSheet>);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });
});
