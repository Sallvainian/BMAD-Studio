/**
 * @vitest-environment jsdom
 */

/**
 * BmadPhaseProgress tests — Phase 3 deliverable §4.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import { BmadPhaseProgress } from '../BmadPhaseProgress';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('BmadPhaseProgress', () => {
  it('renders all four numbered phases', () => {
    render(<BmadPhaseProgress currentPhase="2-planning" />);
    const segments = screen
      .getAllByText(/^phases\./)
      .map((n) => n.textContent);
    expect(segments).toEqual([
      'phases.1-analysis',
      'phases.2-planning',
      'phases.3-solutioning',
      'phases.4-implementation',
    ]);
  });

  it('marks earlier phases complete and current phase active', () => {
    render(<BmadPhaseProgress currentPhase="3-solutioning" />);
    const wrapper = screen.getByTestId('bmad-phase-progress');
    expect(
      wrapper.querySelector('[data-phase="1-analysis"]')?.getAttribute('data-state'),
    ).toBe('complete');
    expect(
      wrapper.querySelector('[data-phase="2-planning"]')?.getAttribute('data-state'),
    ).toBe('complete');
    expect(
      wrapper.querySelector('[data-phase="3-solutioning"]')?.getAttribute('data-state'),
    ).toBe('active');
    expect(
      wrapper.querySelector('[data-phase="4-implementation"]')?.getAttribute('data-state'),
    ).toBe('pending');
  });

  it('fires onPhaseSelect when a segment is clicked', () => {
    const onPhaseSelect = vi.fn();
    render(
      <BmadPhaseProgress
        currentPhase="3-solutioning"
        onPhaseSelect={onPhaseSelect}
      />,
    );
    const segment = screen
      .getByTestId('bmad-phase-progress')
      .querySelector('[data-phase="2-planning"]') as HTMLButtonElement;
    fireEvent.click(segment);
    expect(onPhaseSelect).toHaveBeenCalledWith('2-planning');
  });

  it('renders div tags (not buttons) when onPhaseSelect is omitted', () => {
    render(<BmadPhaseProgress currentPhase="2-planning" />);
    const wrapper = screen.getByTestId('bmad-phase-progress');
    const segments = wrapper.querySelectorAll('[data-phase]');
    for (const seg of segments) {
      expect(seg.tagName).toBe('DIV');
    }
  });

  it('aria-current="step" on the active segment', () => {
    render(<BmadPhaseProgress currentPhase="2-planning" onPhaseSelect={vi.fn()} />);
    const wrapper = screen.getByTestId('bmad-phase-progress');
    const active = wrapper.querySelector('[data-phase="2-planning"]') as HTMLElement;
    expect(active.getAttribute('aria-current')).toBe('step');
  });
});
