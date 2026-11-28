from PIL import Image, ImageDraw
import interior

def render():
  # 마을회관 2층 전시관 배경(위에서 본 픽셀, 16px 타일, 1층과 같은 42×18칸 = 672×288). maps/hall2.ts와 좌표를 맞춘다.
  # 오른쪽 엘리베이터·계단 구역(유리벽 x35부터)은 1층 그림(interior.py)을 그대로 쓰고, 왼쪽 x0~34만 전시관으로 덮는다.
  # 전시한 물고기(유리 상자)·확장 전 공사 테이프·테마는 게임이 덧그린다(scene.ts drawGallery). build-hall-art.py가 부른다.
  T=16
  TW,TH=42,18
  W,H=TW*T,TH*T
  im=interior.render().copy()
  d=ImageDraw.Draw(im)
  C=lambda h: tuple(int(h[i:i+2],16) for i in (1,3,5))
  def box(x0,y0,x1,y1,c): d.rectangle([x0,y0,x1,y1],fill=C(c))
  def tiles(x0,y0,x1,y1,a,b):
    for ty in range(y0,y1+1):
      for tx in range(x0,x1+1):
        box(tx*T,ty*T,tx*T+T-1,ty*T+T-1,a if (tx+ty)%2 else b)
  WALL='#efe9df'; WALLF='#d7cfc2'
  MARBLE='#e8e4dc'; MARBLE2='#dcd6cb'; VEIN='#cfc7ba'
  CARPET='#8e2a2e'; GOLD='#c9a54a'; GOLDL='#e6c96f'
  STONE='#bdb6aa'; STONEL='#d9d3c8'; STONED='#8f897f'
  WOOD='#8a5a3a'; WOODL='#a8754c'
  PARQ='#b98b5e'; PARQ2='#a97b50'
  GR=35*T-4   # 전시관 오른쪽 끝 픽셀(유리벽 x35 왼쪽 반 앞까지)
  # 전시관 자리를 비우고 대리석 체크 + 결
  box(0,0,GR,H-1,'#28213a')
  tiles(1,1,34,16,MARBLE,MARBLE2)
  box(34*T,1*T,GR,17*T-1,MARBLE2 if (34+1)%2 else MARBLE)
  for (x,y) in ((8,5),(13,9),(19,6),(24,12),(10,12),(26,4),(16,8),(30,10),(3,7),(31,3)):
    d.line([(x*T+2,y*T+3),(x*T+12,y*T+9)],fill=C(VEIN),width=1)
  # 확장 구역(아래 띠 y14~15, x6~25): 나무 마루 + 번호판
  DIG={1:['.#.','##.','.#.','.#.','###'],2:['##.','..#','.#.','#..','###'],3:['##.','..#','.#.','..#','##.'],4:['#.#','#.#','###','..#','..#'],5:['###','#..','##.','..#','##.']}
  for k,tx in enumerate((6,10,14,18,22)):
    for ty in (14,15):
      for xx in range(tx,tx+4):
        for i in range(4):
          box(xx*T,ty*T+i*4,xx*T+T-1,ty*T+i*4+3,PARQ if (i+xx)%2 else PARQ2)
    box(tx*T,14*T,tx*T+4*T-1,14*T,'#7a5634')
    px,py=tx*T+2*T-5,14*T+3
    box(px,py,px+9,py+8,'#f7f7f4'); box(px,py+8,px+9,py+8,STONED)
    for yy,row in enumerate(DIG[k+1]):
      for xx,ch in enumerate(row):
        if ch=='#': box(px+3+xx,py+2+yy,px+3+xx,py+2+yy,'#2a2135')
  # 붉은 카펫(칸을 꽉 채운다, 테마 바닥과 칸 경계가 맞게): 데스크 → 단상(x16~18 y5~12), 데스크 오른쪽 → 유리문(y13 x19~34, x33~34 y13~16)
  box(16*T,5*T,19*T-1,13*T-1,CARPET); box(16*T,5*T,16*T+1,13*T-1,GOLD); box(19*T-2,5*T,19*T-1,13*T-1,GOLD)
  box(19*T,13*T,GR,14*T-1,CARPET); box(19*T,13*T,33*T-1,13*T+1,GOLD); box(19*T,14*T-2,33*T-1,14*T-1,GOLD)
  box(33*T,13*T,GR,17*T-1,CARPET); box(33*T,14*T,33*T+1,17*T-1,GOLD)
  # 신화 단상(위 가운데, x14~20 y2~4): 금테 계단 단
  box(14*T,2*T,21*T-1,5*T-1,'#5b3a6e'); box(14*T,2*T,21*T-1,2*T+2,GOLDL); box(14*T,5*T-3,21*T-1,5*T-1,GOLD)
  for x in range(14*T+2,21*T-2,6): box(x,5*T-6,x+2,5*T-5,'#7d5a92')
  # 받침대: 돌 기둥 + 금 명판(신화는 금 받침)
  def pedestal(tx,ty,mythic=False):
    x,y=tx*T,ty*T
    box(x+1,y+2,x+T-2,y+T-1,STONED)
    box(x+2,y+2,x+T-3,y+T-3,STONEL if not mythic else GOLDL)
    box(x+3,y+4,x+T-4,y+T-5,STONE if not mythic else GOLD)
    box(x+4,y+T-2,x+T-5,y+T-1,GOLD)
  for tx in (15,17,19): pedestal(tx,3,True)
  for ty in (7,10):
    for tx in (8,11,14,21,24): pedestal(tx,ty)
  # 안내 데스크(17,12): 나무 + 방명록
  x,y=17*T,12*T
  box(x-2,y+1,x+T+1,y+T-1,WOOD); box(x-2,y+1,x+T+1,y+3,WOODL); box(x+3,y+6,x+T-4,y+11,'#f3efe4'); box(x+T//2,y+6,x+T//2,y+11,'#9aa3ab')
  # ---- 바깥 벽(1층과 같은 두꺼운 흰 벽, 위쪽 벽 면에 창). 오른쪽 구역(x35~)은 1층 그림 그대로
  box(0,0,GR,T-1,WALLF); box(0,0,GR,3,WALL)
  for wx in (2,7,12,17,22,27):
    x=wx*T; box(x,5,x+T*2,T-4,'#9fc4d6'); box(x,5,x+T*2,6,'#e6f4fa')
  box(0,0,T-1,H-1,WALL); box(0,H-T,GR,H-1,WALL); box(0,H-T,GR,H-T+3,WALLF)
  # 벽 액자(전시관 분위기): 왼쪽 벽
  for ty in (3,8,12):
    box(2,ty*T,T-3,ty*T+T+4,GOLD); box(4,ty*T+2,T-5,ty*T+T+2,('#6f8fb0','#8fae7a','#b07a6f')[(3,8,12).index(ty)])
  # 화분(빈 모서리)
  for (x,y) in ((1*T+4,1*T+4),(34*T+2,1*T+4)):
    box(x,y+6,x+8,y+14,WOOD); d.ellipse([x-3,y-4,x+11,y+8],fill=C('#4f7d3a'))
  return im
