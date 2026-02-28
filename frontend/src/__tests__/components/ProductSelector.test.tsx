import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, test, expect, vi } from 'vitest';
import ProductSelector from '../../components/ProductSelector';

describe('ProductSelector', () => {
  test('renders all 3 product names', () => {
    render(<ProductSelector onSelect={vi.fn()} />);
    expect(screen.getByText('Mid-Century Modern Velvet Sofa')).toBeInTheDocument();
    expect(screen.getByText('Industrial Floor Lamp')).toBeInTheDocument();
    expect(screen.getByText('Scandinavian Accent Chair')).toBeInTheDocument();
  });

  test('renders all 3 category badges', () => {
    render(<ProductSelector onSelect={vi.fn()} />);
    expect(screen.getByText('Sofa')).toBeInTheDocument();
    expect(screen.getByText('Lighting')).toBeInTheDocument();
    expect(screen.getByText('Chair')).toBeInTheDocument();
  });

  test('calls onSelect with the correct product when a card is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ProductSelector onSelect={onSelect} />);

    await user.click(screen.getByText('Mid-Century Modern Velvet Sofa'));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'prod_1',
        name: 'Mid-Century Modern Velvet Sofa',
        category: 'Sofa'
      })
    );
  });

  test('calls onSelect with the lamp product when the lamp card is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ProductSelector onSelect={onSelect} />);

    await user.click(screen.getByText('Industrial Floor Lamp'));

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'prod_2', category: 'Lighting' })
    );
  });
});
