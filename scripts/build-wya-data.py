#!/usr/bin/env python3
"""후알야(who-are-ya) 데이터 생성: data/fotmob_squads.json → src/games/who-are-ya/data.ts

표준 라이브러리만 쓴다. 사용법: python3 scripts/build-wya-data.py
변환 규칙은 원본 단독판(build_wy.py)과 같다. 규칙을 바꾸면 logic.version을 올린다(CLAUDE.md 로직 버전 규칙).
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'data', 'fotmob_squads.json')
OUT = os.path.join(ROOT, 'src', 'games', 'who-are-ya', 'data.ts')

CODE = {'Manchester City':'MCI','Arsenal':'ARS','Brighton & Hove Albion':'BHA','Liverpool':'LIV','Chelsea':'CHE','Brentford':'BRE','Leeds United':'LEE',
 'Newcastle United':'NEW','Aston Villa':'AVL','Hull City':'HUL','Everton':'EVE','Ipswich Town':'IPS','AFC Bournemouth':'BOU','Tottenham Hotspur':'TOT',
 'Fulham':'FUL','Manchester United':'MUN','Crystal Palace':'CRY','Nottingham Forest':'NFO','Coventry City':'COV','Sunderland':'SUN',
 'Barcelona':'BAR','Atlético Madrid':'ATM','Real Madrid':'RMA','Real Betis':'BET','Real Sociedad':'RSO','Sevilla':'SEV','Deportivo Alavés':'ALA',
 'Athletic Club':'ATH','Celta Vigo':'CEL','Villarreal':'VIL','Deportivo A Coruña':'DEP','Espanyol':'ESP','Osasuna':'OSA','Racing Santander':'RAC',
 'Levante':'LEV','Elche':'ELC','Rayo Vallecano':'RAY','Getafe':'GET','Valencia':'VAL','Málaga':'MAL',
 'Inter':'INT','Lazio':'LAZ','Roma':'ROM','Como':'COM','Milan':'MIL','Frosinone':'FRO','Napoli':'NAP','Juventus':'JUV','Torino':'TOR','Cagliari':'CAG',
 'Bologna':'BOL','Atalanta':'ATA','Genoa':'GEN','Lecce':'LEC','Sassuolo':'SAS','Monza':'MON','Udinese':'UDI','Fiorentina':'FIO','Parma':'PAR','Venezia':'VEN',
 'Bayern München':'FCB','Borussia Dortmund':'BVB','Freiburg':'SCF','Bayer Leverkusen':'B04','Elversberg':'SVE','RB Leipzig':'RBL','Werder Bremen':'SVW',
 'Mainz 05':'M05','Augsburg':'FCA','Hoffenheim':'TSG','Hamburger SV':'HSV','1. FC Köln':'KOE','Paderborn':'SCP','Eintracht Frankfurt':'SGE',
 'VfB Stuttgart':'VFB','Schalke 04':'S04','Union Berlin':'FCU','Borussia Mönchengladbach':'BMG',
 'Paris Saint-Germain':'PSG','Lille':'LIL','Rennes':'REN','Monaco':'ASM','Lyon':'OL','Paris FC':'PFC','Nice':'NIC','Lens':'RCL','Marseille':'OM',
 'Lorient':'FCL','Toulouse':'TFC','Auxerre':'AJA','Brest':'SB29','Angers':'SCO','Le Mans':'LMF','Strasbourg':'RCS','Troyes':'EST','Le Havre':'HAC'}
BIG = {'Manchester United','Tottenham Hotspur','Juventus','Atalanta','Eintracht Frankfurt','VfB Stuttgart','Marseille','Napoli','Milan','Aston Villa',
       'Newcastle United','Atlético Madrid','Real Madrid','Barcelona','Bayern München','Borussia Dortmund','Paris Saint-Germain','Bayer Leverkusen',
       'RB Leipzig','Villarreal','Athletic Club','Real Sociedad','Lyon','Monaco','Lille','Roma','Lazio','Inter','Chelsea','Arsenal','Liverpool','Manchester City'}
LEAGUE_KO = {'Premier League':'프리미어리그','LaLiga':'라리가','Serie A':'세리에 A','Bundesliga':'분데스리가','Ligue 1':'리그 1'}
# manifest의 league 옵션 값. manifest.ts와 맞아야 한다(logic.test.ts가 확인)
LEAGUE_ID = {'Premier League':'premier-league','LaLiga':'laliga','Serie A':'serie-a','Bundesliga':'bundesliga','Ligue 1':'ligue-1'}
GROUP = {'GK':'GK','CB':'DF','LB':'DF','RB':'DF','LWB':'DF','RWB':'DF','CDM':'MF','CM':'MF','CAM':'MF','LM':'MF','RM':'MF','LW':'FW','RW':'FW','ST':'FW','CF':'FW'}
ROLEG = {'keeper_long':'GK','defender_long':'DF','midfielder_long':'MF','attacker_long':'FW'}


def build(d):
    leagues = list(d['leagues'].keys())
    teams, tix, players, missing = [], {}, [], []
    for li, (ln, L) in enumerate(d['leagues'].items()):
        n = len(L['table'])
        for t in L['table']:
            if t['name'] not in L['squads']:
                missing.append(t['name'])
        for tn, S in L['squads'].items():
            tix[tn] = len(teams)
            teams.append([tn, CODE.get(tn, tn[:3].upper()), li, S['rank']])
            topclub = S['rank'] <= n // 2 or tn in BIG
            for p in S['players']:
                if 'role' not in p:
                    continue  # 감독·유스 목록 제외
                desc = p.get('positionIdsDesc') or ''
                main = desc.split(',')[0] if desc else ''
                grp = GROUP.get(main) or ROLEG.get(p['role']['key'], 'MF')
                val = (p.get('transferValue') or 0) / 1e6
                tier = 1 if val >= 30 else 2 if (topclub and val >= 12) else 3
                sh = p.get('shirtNumber')
                players.append([p['id'], p['name'], tix[tn], p.get('ccode') or '', p.get('cname') or '', main or grp, grp,
                                p.get('age'), int(sh) if str(sh).isdigit() else None, tier])
    league_rows = [[LEAGUE_ID.get(l, l.lower().replace(' ', '-')), l, LEAGUE_KO.get(l, l)] for l in leagues]
    return {'fetched': d.get('fetched_at', ''), 'leagues': league_rows, 'teams': teams, 'players': players, 'missing': missing}


def js(v):
    return json.dumps(v, ensure_ascii=False, separators=(',', ':'))


def emit(data):
    lines = [
        '// generated — do not edit; run scripts/build-wya-data.py',
        '// 원본: data/fotmob_squads.json (FotMob 스쿼드). 외부 의존 없음 (Deno 호환).',
        '',
        '/** [옵션 id, 원본 리그 이름, 한국어 이름] */',
        'export type LeagueRow = [id: string, name: string, ko: string]',
        '/** [이름, 코드, 리그 번호, 리그 순위] */',
        'export type TeamRow = [name: string, code: string, league: number, rank: number]',
        '/** [id, 이름, 팀 번호, 국가 코드, 국가 이름, 세부 포지션, 포지션 그룹, 나이, 등번호, 티어(1~3)] */',
        'export type PlayerRow = [',
        '  id: number, name: string, team: number, cc: string, cn: string, pos: string,',
        '  grp: string, age: number | null, shirt: number | null, tier: number,',
        ']',
        '',
        f'export const FETCHED = {js(data["fetched"])}',
        f'export const MISSING_TEAMS: string[] = {js(data["missing"])}',
        f'export const LEAGUES: LeagueRow[] = {js(data["leagues"])}',
        'export const TEAMS: TeamRow[] = [',
    ]
    lines += [f'  {js(t)},' for t in data['teams']]
    lines += [']', 'export const PLAYERS: PlayerRow[] = [']
    lines += [f'  {js(p)},' for p in data['players']]
    lines += [']', '']
    return '\n'.join(lines)


def main():
    with open(SRC, encoding='utf-8') as f:
        d = json.load(f)
    data = build(d)
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(emit(data))
    ps = data['players']
    print('players', len(ps), 'tiers', {t: sum(1 for p in ps if p[9] <= t) for t in (1, 2, 3)}, 'missing', data['missing'])
    print(OUT, os.path.getsize(OUT) // 1024, 'KB')


if __name__ == '__main__':
    main()
