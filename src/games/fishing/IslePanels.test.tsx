import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { BoatPanel, DecoPanel, IsleChoosePanel } from './IslePanels.tsx'

const noop = () => {}

describe('BoatPanel', () => {
  test('세 목적지 버튼, 친구 목록 없음(누르기 전)', () => {
    render(<BoatPanel busy={false} friends={null} note={null} onIsland={noop} onMine={noop} onFriends={noop} onFriend={noop} />)
    for (const name of ['섬', '내 섬', '친구 섬']) expect(screen.getByRole('button', { name })).toBeEnabled()
    expect(screen.queryByText('아직 섬이 있는 친구가 없어요')).not.toBeInTheDocument()
  })
  test('빈 목록 안내, 친구를 누르면 그 친구, 안내 문구', () => {
    const onFriend = vi.fn()
    const { rerender } = render(<BoatPanel busy={false} friends={[]} note={null} onIsland={noop} onMine={noop} onFriends={noop} onFriend={onFriend} />)
    expect(screen.getByText('아직 섬이 있는 친구가 없어요')).toBeInTheDocument()
    const mj = { id: 'x', handle: 'mj', avatar: null }
    rerender(<BoatPanel busy={false} friends={[mj]} note="섬에 갈 수 없어요" onIsland={noop} onMine={noop} onFriends={noop} onFriend={onFriend} />)
    fireEvent.click(screen.getByRole('button', { name: 'mj의 섬' }))
    expect(onFriend).toHaveBeenCalledWith(mj)
    expect(screen.getByRole('status')).toHaveTextContent('섬에 갈 수 없어요')
  })
  test('busy면 버튼이 꺼진다', () => {
    render(<BoatPanel busy friends={null} note={null} onIsland={noop} onMine={noop} onFriends={noop} onFriend={noop} />)
    expect(screen.getByRole('button', { name: '내 섬' })).toBeDisabled()
  })
})

describe('IsleChoosePanel', () => {
  test('두 모양과 안내, 누르면 그 모양', () => {
    const onChoose = vi.fn()
    render(<IsleChoosePanel busy={false} onChoose={onChoose} />)
    expect(screen.getByText('고르면 바꿀 수 없어요')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '쌍둥이 만 섬' }))
    expect(onChoose).toHaveBeenCalledWith('twin')
    expect(screen.getByRole('button', { name: '초승달 섬' })).toBeInTheDocument()
  })
})

describe('DecoPanel', () => {
  test('그 칸에 못 놓는 꾸미기(막는 것)는 버튼이 꺼진다', () => {
    render(<DecoPanel box={{ path: 1, fence: 2 }} busy={false} allowed={(id) => id === 'path'} onPick={() => {}} />)
    expect(screen.getByRole('button', { name: '돌길 1개' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '울타리 2개' })).toBeDisabled()
  })
})
