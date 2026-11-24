import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectDigests } from '../src/main/pipeline/collector'
import {
  COMMIT_BODY_MAX_CHARS,
  MAX_COMMITS_PER_DAY,
  attachCommits
} from '../src/main/pipeline/commits'

const ME = 'me@example.com'

/** 사용자 전역 git 설정(훅, 서명, 템플릿)이 테스트 저장소에 끼지 않게 한다 */
const EMPTY_GLOBAL = join(mkdtempSync(join(tmpdir(), 'worklog-gitconfig-')), 'empty')
writeFileSync(EMPTY_GLOBAL, '')
const ISOLATED = { GIT_CONFIG_GLOBAL: EMPTY_GLOBAL, GIT_CONFIG_NOSYSTEM: '1' }

interface CommitOpts {
  /** 커밋 시각. 체리픽이나 리베이스처럼 작성 시각과 다르게 줄 때 쓴다 */
  committedAt?: string
  /** 작성자 메일. 다른 사람의 커밋을 만들 때 쓴다 */
  email?: string
}

/** 임시 git 저장소. 작성 시각과 커밋 시각을 정해 커밋한다 */
function makeRepo(): {
  dir: string
  run: (args: string[], env?: Record<string, string>) => string
  commit: (message: string, at: string, opts?: CommitOpts) => void
} {
  const dir = mkdtempSync(join(tmpdir(), 'worklog-repo-'))
  const run = (args: string[], env: Record<string, string> = {}): string =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, ...ISOLATED, ...env } })
  run(['init', '-q', '-b', 'main'])
  run(['config', 'user.email', ME])
  run(['config', 'user.name', 'Me'])
  const commit = (message: string, at: string, opts: CommitOpts = {}): void => {
    const email = opts.email ?? ME
    run(['commit', '-q', '--allow-empty', '-m', message], {
      GIT_AUTHOR_DATE: at,
      GIT_COMMITTER_DATE: opts.committedAt ?? at,
      GIT_AUTHOR_EMAIL: email,
      GIT_AUTHOR_NAME: 'Someone',
      GIT_COMMITTER_EMAIL: email,
      GIT_COMMITTER_NAME: 'Someone'
    })
  }
  return { dir, run, commit }
}

/** 대화 로그 픽스처. 대화마다 그 폴더에서 그 시각에 프롬프트를 하나 쳤다 */
function claudeDirWith(...talks: { cwd: string; at: string }[]): string {
  const base = mkdtempSync(join(tmpdir(), 'worklog-claude-'))
  talks.forEach((t, i) => {
    const dir = join(base, 'projects', `p${i}`)
    mkdirSync(dir, { recursive: true })
    const rec = {
      type: 'user',
      timestamp: t.at,
      cwd: t.cwd,
      sessionId: `s${i}`,
      message: { role: 'user', content: '작업해 줘' }
    }
    writeFileSync(join(dir, `s${i}.jsonl`), JSON.stringify(rec) + '\n')
  })
  return base
}

async function digestsWithCommits(
  claudeDir: string,
  start: string,
  end: string,
  knownRepos: string[] = []
): Promise<{ digests: Awaited<ReturnType<typeof collectDigests>>['digests']; found: string[] | null }> {
  const { digests } = await collectDigests(start, end, { claudeDir })
  const found = await attachCommits(digests, start, end, { claudeDir, git: 'git', knownRepos })
  return { digests, found }
}

/** 하루치 커밋 제목만 저장소 순서대로 */
function subjectsOf(
  digests: Awaited<ReturnType<typeof collectDigests>>['digests'],
  date: string
): string[] {
  return (digests.get(date)?.commits ?? []).flatMap((r) => r.commits.map((c) => c.subject))
}

describe('attachCommits', () => {
  it('그날 대화한 저장소에서 그날 작성한 내 커밋을 그 프로젝트에 붙인다', async () => {
    const repo = makeRepo()
    repo.commit(
      '로그인 버튼 색 변경\n\n디자인 시안에 맞췄다.\n다크 모드에서도 확인했다.',
      '2026-07-15T11:26:00+09:00'
    )
    repo.commit('전날 작업', '2026-07-14T18:00:00+09:00')
    repo.commit('다른 사람 작업', '2026-07-15T12:00:00+09:00', { email: 'other@example.com' })
    const claudeDir = claudeDirWith({ cwd: repo.dir, at: '2026-07-15T01:00:00.000Z' })

    const { digests, found } = await digestsWithCommits(claudeDir, '2026-07-15', '2026-07-15')

    expect(digests.get('2026-07-15')?.commits).toEqual([
      {
        name: basename(repo.dir),
        projectCwd: repo.dir,
        commits: [
          {
            hhmm: '11:26',
            subject: '로그인 버튼 색 변경',
            body: '디자인 시안에 맞췄다.\n다크 모드에서도 확인했다.'
          }
        ]
      }
    ])
    // 다음부터 이 저장소의 대화를 모두 지워도 찾을 수 있게 기억해 둔다
    expect(found).toEqual([repo.dir])
  })

  it('커밋 시각이 아니라 작성 시각으로 날짜를 나눈다', async () => {
    // 체리픽이나 리베이스는 커밋 시각만 그날로 바꾼다.
    // 커밋 시각으로 나누면 전에 한 작업이 그날 한 일로 잡힌다.
    const repo = makeRepo()
    repo.commit('목록 정렬 수정', '2026-07-14T17:02:00+09:00', {
      committedAt: '2026-07-15T13:41:00+09:00'
    })
    const claudeDir = claudeDirWith(
      { cwd: repo.dir, at: '2026-07-14T01:00:00.000Z' },
      { cwd: repo.dir, at: '2026-07-15T01:00:00.000Z' }
    )

    const { digests } = await digestsWithCommits(claudeDir, '2026-07-14', '2026-07-15')

    expect(subjectsOf(digests, '2026-07-14')).toEqual(['목록 정렬 수정'])
    expect(subjectsOf(digests, '2026-07-15')).toEqual([])
  })

  it('체리픽으로 같은 제목의 커밋이 여럿이어도 한 번만 담는다', async () => {
    const repo = makeRepo()
    repo.commit('결제 오류 수정', '2026-07-15T10:00:00+09:00')
    repo.run(['checkout', '-q', '-b', 'release'])
    repo.commit('결제 오류 수정', '2026-07-15T10:00:00+09:00', {
      committedAt: '2026-07-15T16:00:00+09:00'
    })
    const claudeDir = claudeDirWith({ cwd: repo.dir, at: '2026-07-15T01:00:00.000Z' })

    const { digests } = await digestsWithCommits(claudeDir, '2026-07-15', '2026-07-15')

    expect(subjectsOf(digests, '2026-07-15')).toEqual(['결제 오류 수정'])
  })

  it('그날 대화가 남지 않은 저장소도 최근에 대화한 폴더면 커밋을 잡는다', async () => {
    // 여러 프로젝트를 오가다 한 프로젝트의 그날 대화를 지운 경우다
    const talked = makeRepo()
    const deleted = makeRepo()
    deleted.commit('알림 문구 수정', '2026-07-15T11:00:00+09:00')
    const claudeDir = claudeDirWith(
      { cwd: talked.dir, at: '2026-07-15T01:00:00.000Z' },
      // 그날 대화는 지웠고 열흘 전 대화만 남았다
      { cwd: deleted.dir, at: '2026-07-05T01:00:00.000Z' }
    )

    const { digests } = await digestsWithCommits(claudeDir, '2026-07-15', '2026-07-15')

    // 그날 대화가 없으니 붙일 프로젝트가 없다
    expect(digests.get('2026-07-15')?.commits).toEqual([
      { name: basename(deleted.dir), commits: [{ hhmm: '11:00', subject: '알림 문구 수정' }] }
    ])
  })

  it('기억해 둔 저장소는 남은 대화가 하나도 없어도 본다', async () => {
    const talked = makeRepo()
    const forgotten = makeRepo()
    forgotten.commit('배포 스크립트 정리', '2026-07-15T15:30:00+09:00')
    const claudeDir = claudeDirWith({ cwd: talked.dir, at: '2026-07-15T01:00:00.000Z' })

    const { digests, found } = await digestsWithCommits(claudeDir, '2026-07-15', '2026-07-15', [
      forgotten.dir
    ])

    expect(subjectsOf(digests, '2026-07-15')).toEqual(['배포 스크립트 정리'])
    expect([...(found ?? [])].sort()).toEqual([forgotten.dir, talked.dir].sort())
  })

  it('머지 커밋과 stash는 빼고 트레일러는 본문에서 지운다', async () => {
    const repo = makeRepo()
    const at = '2026-07-15T10:00:00+09:00'
    repo.commit('시작', '2026-07-01T10:00:00+09:00')
    repo.run(['checkout', '-q', '-b', 'feature'])
    repo.commit(
      '검색 필터 추가\n\n필터를 주소에 남긴다.\n\nCo-Authored-By: Bot <bot@example.com>',
      at
    )
    repo.run(['checkout', '-q', 'main'])
    const env = { GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at }
    repo.run(['merge', '-q', '--no-ff', '-m', "Merge branch 'feature'", 'feature'], env)
    writeFileSync(join(repo.dir, 'wip.txt'), 'wip')
    repo.run(['add', 'wip.txt'])
    repo.run(['stash', '-q'], env)
    const claudeDir = claudeDirWith({ cwd: repo.dir, at: '2026-07-15T01:00:00.000Z' })

    const { digests } = await digestsWithCommits(claudeDir, '2026-07-15', '2026-07-15')

    expect(digests.get('2026-07-15')?.commits?.[0]?.commits).toEqual([
      { hhmm: '10:00', subject: '검색 필터 추가', body: '필터를 주소에 남긴다.' }
    ])
  })

  it('숫자만 다른 제목이 여러 날 되풀이되는 커밋은 자동으로 만든 것으로 보고 뺀다', async () => {
    // 배포 자동화가 매일 같은 제목으로 내 이름의 커밋을 남기는 저장소가 있다
    const repo = makeRepo()
    for (const day of ['13', '14', '15']) {
      repo.commit(`chore: 야간 빌드 결과 기록 (2026-07-${day} 01:38)`, `2026-07-${day}T01:41:00+09:00`)
    }
    repo.commit('주문 내역 필터 추가', '2026-07-15T14:00:00+09:00')
    const claudeDir = claudeDirWith({ cwd: repo.dir, at: '2026-07-15T01:00:00.000Z' })

    const { digests } = await digestsWithCommits(claudeDir, '2026-07-15', '2026-07-15')

    expect(subjectsOf(digests, '2026-07-15')).toEqual(['주문 내역 필터 추가'])
  })

  it('본문은 앞부분만 담는다', async () => {
    const repo = makeRepo()
    repo.commit(`긴 설명\n\n${'가'.repeat(COMMIT_BODY_MAX_CHARS + 50)}`, '2026-07-15T10:00:00+09:00')
    const claudeDir = claudeDirWith({ cwd: repo.dir, at: '2026-07-15T01:00:00.000Z' })

    const { digests } = await digestsWithCommits(claudeDir, '2026-07-15', '2026-07-15')

    expect(digests.get('2026-07-15')?.commits?.[0]?.commits[0]?.body).toBe(
      `${'가'.repeat(COMMIT_BODY_MAX_CHARS)}…`
    )
  })

  it('하루 상한을 넘으면 이른 커밋부터 남기고 나머지는 개수만 적는다', async () => {
    const repo = makeRepo()
    for (let i = 0; i <= MAX_COMMITS_PER_DAY; i++) {
      repo.commit(`작업 ${i}`, `2026-07-15T09:${String(i).padStart(2, '0')}:00+09:00`)
    }
    const claudeDir = claudeDirWith({ cwd: repo.dir, at: '2026-07-15T01:00:00.000Z' })

    const { digests } = await digestsWithCommits(claudeDir, '2026-07-15', '2026-07-15')

    const rc = digests.get('2026-07-15')?.commits?.[0]
    expect(rc?.commits).toHaveLength(MAX_COMMITS_PER_DAY)
    expect(rc?.commits[0]?.subject).toBe('작업 0')
    expect(rc?.overflow).toBe(1)
  }, 20_000)

  it('git이 없으면 빈 배열만 남기고 기억할 목록은 주지 않는다', async () => {
    // 빈 배열은 커밋을 모은 원본이라는 표식이다.
    // 없으면 그 날짜를 열 때마다 다시 모으려 든다.
    const claudeDir = claudeDirWith({ cwd: tmpdir(), at: '2026-07-15T01:00:00.000Z' })
    const { digests } = await collectDigests('2026-07-15', '2026-07-15', { claudeDir })

    expect(await attachCommits(digests, '2026-07-15', '2026-07-15', { claudeDir, git: null })).toBeNull()
    expect(digests.get('2026-07-15')?.commits).toEqual([])

    const missing = join(tmpdir(), 'no-such-git')
    expect(
      await attachCommits(digests, '2026-07-15', '2026-07-15', { claudeDir, git: missing })
    ).toBeNull()
    expect(digests.get('2026-07-15')?.commits).toEqual([])
  })
})
