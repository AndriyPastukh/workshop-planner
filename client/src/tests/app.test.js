import { describe, expect, it } from 'vitest';
import App from '../App.jsx';

describe('App component', () => {
  it('exports a valid React component function', () => {
    expect(typeof App).toBe('function');
    expect(App.name).toBe('App');
  });
});
