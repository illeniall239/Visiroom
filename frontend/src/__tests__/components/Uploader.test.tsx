import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import Uploader from '../../components/Uploader';

// Helper: simulate a file being selected on the hidden <input type="file">.
// We use fireEvent.change with a custom `files` property instead of
// userEvent.upload so we can bypass the `accept` attribute filter — jsdom
// enforces accept filtering in userEvent but not in raw fireEvent.
function simulateFileSelect(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { writable: true, value: [file] });
  fireEvent.change(input);
}

// Mock FileReader so readAsDataURL calls onload synchronously with a fake result.
function setupFileReaderMock(fakeResult: string) {
  vi.spyOn(globalThis, 'FileReader').mockImplementation(function (this: any) {
    this.readAsDataURL = vi.fn(() => {
      Promise.resolve().then(() => {
        this.result = fakeResult;
        this.onload?.({ target: { result: fakeResult } } as ProgressEvent<FileReader>);
      });
    });
  } as unknown as typeof FileReader);
}

describe('Uploader', () => {
  const onUploadComplete = vi.fn();
  const defaultProps = {
    apiUrl: 'http://localhost:3001',
    onUploadComplete,
    label: 'Room',
    description: 'Upload room image'
  };

  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  test('renders label and description text', () => {
    render(<Uploader {...defaultProps} />);
    expect(screen.getByText('Room')).toBeInTheDocument();
    expect(screen.getByText('Upload room image')).toBeInTheDocument();
  });

  test('shows error when file exceeds 10MB', async () => {
    render(<Uploader {...defaultProps} />);
    const bigFile = new File([new Uint8Array(11 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' });
    simulateFileSelect(bigFile);
    await screen.findByText('FILE EXCEEDS 10MB LIMIT.');
  });

  test('shows error for non-image file types (e.g., PDF)', async () => {
    render(<Uploader {...defaultProps} />);
    // Use simulateFileSelect to bypass the accept attribute filter
    const pdf = new File(['pdf content'], 'document.pdf', { type: 'application/pdf' });
    simulateFileSelect(pdf);
    await screen.findByText('INVALID FORMAT. USE JPEG, PNG, WEBP.');
  });

  test('calls onUploadComplete with base64 string on valid JPEG upload', async () => {
    const FAKE_BASE64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgAB';
    setupFileReaderMock(FAKE_BASE64);

    render(<Uploader {...defaultProps} />);
    const jpegFile = new File([new Uint8Array(1024)], 'room.jpg', { type: 'image/jpeg' });
    simulateFileSelect(jpegFile);

    // Component calls onUploadComplete after a 400ms setTimeout — wait for it
    await waitFor(() => {
      expect(onUploadComplete).toHaveBeenCalledTimes(1);
    }, { timeout: 1000 });

    const [_genId, imageKey, base64] = onUploadComplete.mock.calls[0];
    expect(imageKey).toBe('local_file');
    expect(base64).toBe(FAKE_BASE64);
  }, 3000);

  test('does not show error initially', () => {
    render(<Uploader {...defaultProps} />);
    expect(screen.queryByText(/EXCEEDS/)).not.toBeInTheDocument();
    expect(screen.queryByText(/INVALID FORMAT/)).not.toBeInTheDocument();
  });
});
