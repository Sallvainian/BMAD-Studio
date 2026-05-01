/**
 * @vitest-environment jsdom
 */

/**
 * Tests for BmadTutorialOverlay (Phase 4 deliverable §5).
 *
 * Verifies:
 *   - returns null when tutorialDismissed is true
 *   - renders 3-step counter, advances forward + back
 *   - skip button dismisses
 *   - done button on last step dismisses + persists in localStorage
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import { BmadTutorialOverlay } from '../BmadTutorialOverlay';
import { useBmadStore } from '../../../stores/bmad-store';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && typeof opts === 'object') {
        return `${key}:${JSON.stringify(opts)}`;
      }
      return key;
    },
    i18n: { language: 'en' },
  }),
}));

const TUTORIAL_STORAGE_KEY = 'bmad.tutorial.dismissed';

describe('BmadTutorialOverlay', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useBmadStore.setState({ tutorialDismissed: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when tutorial is already dismissed', () => {
    useBmadStore.setState({ tutorialDismissed: true });
    const { container } = render(<BmadTutorialOverlay />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the dialog with step 1 of 3 by default', () => {
    render(<BmadTutorialOverlay />);
    expect(screen.getByTestId('bmad-tutorial-overlay')).toBeInTheDocument();
    expect(screen.getByText(/tutorial.stepCounter:/)).toHaveTextContent('"current":1');
    expect(screen.getByText(/tutorial.stepCounter:/)).toHaveTextContent('"total":3');
    expect(screen.getByText('tutorial.step1Title')).toBeInTheDocument();
  });

  it('advances through all steps and dismisses on the final Done click', () => {
    render(<BmadTutorialOverlay />);
    fireEvent.click(screen.getByTestId('bmad-tutorial-next-button'));
    expect(screen.getByText('tutorial.step2Title')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('bmad-tutorial-next-button'));
    expect(screen.getByText('tutorial.step3Title')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('bmad-tutorial-done-button'));
    expect(useBmadStore.getState().tutorialDismissed).toBe(true);
    expect(window.localStorage.getItem(TUTORIAL_STORAGE_KEY)).toBe('true');
  });

  it('navigates back via Previous button', () => {
    render(<BmadTutorialOverlay />);
    fireEvent.click(screen.getByTestId('bmad-tutorial-next-button'));
    fireEvent.click(screen.getByTestId('bmad-tutorial-prev-button'));
    expect(screen.getByText('tutorial.step1Title')).toBeInTheDocument();
  });

  it('Skip button dismisses immediately and persists', () => {
    render(<BmadTutorialOverlay />);
    fireEvent.click(screen.getByTestId('bmad-tutorial-skip-button'));
    expect(useBmadStore.getState().tutorialDismissed).toBe(true);
    expect(window.localStorage.getItem(TUTORIAL_STORAGE_KEY)).toBe('true');
  });
});
