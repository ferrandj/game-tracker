import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GameCase } from './GameCase';
import { StarRating } from './StarRating';
import { ProgressRing } from './ProgressRing';

describe('StarRating', () => {
  it('is a labelled picture when read-only', () => {
    render(<StarRating value={7} />);
    expect(screen.getByRole('img', { name: 'Note : 3,5 étoiles sur 5' })).toBeInTheDocument();
    render(<StarRating value={null} />);
    expect(screen.getByRole('img', { name: 'Note : pas encore noté' })).toBeInTheDocument();
  });

  it('picks half stars by click, and clicking the current value clears it', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<StarRating value={null} onChange={onChange} />);
    await user.click(screen.getByRole('radio', { name: '2,5 étoiles sur 5' }));
    expect(onChange).toHaveBeenLastCalledWith(5);
    rerender(<StarRating value={5} onChange={onChange} />);
    await user.click(screen.getByRole('radio', { name: '2,5 étoiles sur 5' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('works with the keyboard: arrows, Home/End, Delete', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<StarRating value={6} onChange={onChange} />);
    screen.getByRole('radio', { name: '3 étoiles sur 5' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith(7);
    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith(5);
    await user.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith(1);
    await user.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith(10);
    await user.keyboard('{Delete}');
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('has a single tab stop (roving tabindex) and shows the value', () => {
    render(<StarRating value={4} onChange={() => undefined} />);
    const stops = screen.getAllByRole('radio').filter((r) => r.getAttribute('tabindex') === '0');
    expect(stops).toHaveLength(1);
    expect(stops[0]).toHaveAccessibleName('2 étoiles sur 5');
    expect(screen.getByText('4/10')).toBeInTheDocument();
  });
});

describe('GameCase', () => {
  const imgs = () => document.querySelectorAll('img');

  it('shows the cover through the server, then the screenshot, then a generated placeholder', () => {
    render(<GameCase game={{ title: 'Hades', cover: 'https://images.igdb.com/c.jpg', art: 'https://images.igdb.com/s.jpg', platform: 'steam' }} />);
    expect(imgs()[0].getAttribute('src')).toBe('api/img?u=https%3A%2F%2Fimages.igdb.com%2Fc.jpg');
    expect(document.querySelector('.case__title')).toBeNull();
    fireEvent.error(imgs()[0]);
    expect(imgs()[0].getAttribute('src')).toBe('api/img?u=https%3A%2F%2Fimages.igdb.com%2Fs.jpg');
    expect(document.querySelector('.case__title')).toHaveTextContent('Hades');
    fireEvent.error(imgs()[0]);
    expect(imgs()).toHaveLength(0);
    expect(document.querySelector('.case__placeholder')).toHaveTextContent('Hades');
  });

  it('draws a spine with the platform and the title, coloured by platform family', () => {
    render(<GameCase game={{ title: 'Bloodborne', cover: null, art: null, platform: 'ps4' }} />);
    expect(document.querySelector('.case')).toHaveAttribute('data-family', 'playstation');
    expect(document.querySelector('.case__spine')).toHaveTextContent('PlayStationBloodborne');
  });

  it('is hidden from assistive technology (the card carries the name)', () => {
    render(<GameCase game={{ title: 'Hades', cover: null, art: null }} />);
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('ProgressRing', () => {
  it('draws the percentage', () => {
    render(<ProgressRing pct={40} />);
    expect(screen.getByRole('img', { name: '40 % complété' })).toBeInTheDocument();
    expect(document.querySelector('.ring__bar')).toHaveAttribute('stroke-dasharray', '40 60');
  });
  it('draws no bar at 0 and a gold ring at 100', () => {
    const { rerender } = render(<ProgressRing pct={0} />);
    expect(document.querySelector('.ring__bar')).toBeNull();
    rerender(<ProgressRing pct={100} />);
    expect(document.querySelector('.ring--full')).not.toBeNull();
  });
});
