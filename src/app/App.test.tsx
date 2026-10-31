import { render, screen } from '@testing-library/react'
import { test, expect } from 'vitest'
import { App } from './App.tsx'

test('renders app shell title', () => {
  render(<App />)
  expect(screen.getByText('ONLYFMS')).toBeInTheDocument()
})
