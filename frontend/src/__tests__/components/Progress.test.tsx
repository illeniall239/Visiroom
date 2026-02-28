import { render, screen } from '@testing-library/react';
import { describe, test, expect } from 'vitest';
import Progress from '../../components/Progress';

describe('Progress', () => {
  test('renders the progress percentage', () => {
    render(<Progress progress={75} message="Generating visualization..." />);
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  test('renders the message text', () => {
    render(<Progress progress={50} message="Placing sofa in the room..." />);
    expect(screen.getByText('Placing sofa in the room...')).toBeInTheDocument();
  });

  test('renders all 4 step labels', () => {
    render(<Progress progress={0} message="Starting..." />);
    expect(screen.getByText('Analyze Room')).toBeInTheDocument();
    expect(screen.getByText('Eval Lighting')).toBeInTheDocument();
    expect(screen.getByText('Generate Viz')).toBeInTheDocument();
    expect(screen.getByText('Finalize')).toBeInTheDocument();
  });

  test('renders 0% correctly', () => {
    render(<Progress progress={0} message="" />);
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  test('renders 100% correctly', () => {
    render(<Progress progress={100} message="Done!" />);
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('Done!')).toBeInTheDocument();
  });
});
