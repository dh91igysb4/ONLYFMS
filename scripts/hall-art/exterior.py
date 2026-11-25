from PIL import Image
import copy

def render():
  # 마을회관 외관(v2, 오렌지 벽돌·발코니). 정면 픽셀 그림 168×H. build-hall-art.py가 부른다.
  W,H=168,116
  P={'.':None,
   'k':'#2a2135',
   'R':'#d48a52','r':'#b9703f','Q':'#e3a06a',   # 벽돌·줄눈·밝은 벽돌
   'M':'#c3c8cc','m':'#949ba1','L':'#e3e6e8','D':'#7d848a',  # 금속 띠
   'H':'#f2f4f5','h':'#c8cdd1',                  # 흰 난간
   'G':'#8fa5b2','g':'#6d8796','i':'#e8f1f5','c':'#eef0ec','F':'#5c656c',  # 유리·커튼·창틀
   'S':'#2d2c31','s':'#47454d','t':'#5a5862',   # 검은 돌
   'J':'#c9d4da','j':'#9fb0ba','f':'#3d474e',   # 계단탑 유리
   'T':'#2e5e4a','u':'#46775f',                 # 1층 초록 창틀
   'w':'#cfcac0','W':'#aaa498',                 # 기단 돌
   'B':'#3d6fb0','b':'#e9eef5',                 # 파란 안내판
   'a':'#f5f6f6','A':'#c9ced2',                 # 실외기
  }
  g=[['.']*W for _ in range(H)]
  def rect(x0,y0,x1,y1,c):
    for y in range(max(0,y0),min(H,y1+1)):
      for x in range(max(0,x0),min(W,x1+1)): g[y][x]=c
  def px(x,y,c):
    if 0<=x<W and 0<=y<H: g[y][x]=c
  def hl(x0,x1,y,c): rect(x0,y,x1,y,c)
  def vl(x,y0,y1,c): rect(x,y0,x,y1,c)

  L0,L1=0,11          # 왼쪽 유리 계단실
  B0,B1=12,129        # 벽돌 몸통
  CF0=94              # 둥근 틀이 시작하는 x(오른쪽 두 칸)
  TG0,TG1=130,139     # 계단탑 유리 기둥
  TS0,TS1=140,163     # 검은 돌
  ROOF=6              # 지붕 띠 위 끝
  FH=22               # 층 높이
  SL=4                # 슬래브 두께
  fl=[ROOF+7+i*FH for i in range(3)]   # 4층·3층·2층 벽 위 끝
  GTOP=ROOF+7+3*FH     # 1층 위(캔틸레버) = 79
  BASE=GTOP+31         # 땅 = 110

  # ---- 벽돌 몸통 전체
  rect(B0,ROOF+4,B1,BASE-1,'R')
  for y in range(ROOF+4,BASE):
    if y%3==0: hl(B0,B1,y,'Q')
    else:
      off=0 if (y//3)%2 else 4
      for x in range(B0+off,B1+1,8): px(x,y,'r')

  # ---- 층마다 창·난간·슬래브
  def window(x,y,w,h):
    rect(x,y,x+w-1,y+h-1,'F')
    rect(x+1,y+1,x+w-2,y+h-2,'G')
    hl(x+1,x+w-2,y+1,'i')
    # 커튼(밝은 천) 양쪽
    rect(x+1,y+2,x+2,y+h-3,'c')
    vl(x+w//2,y+1,y+h-2,'F')
    hl(x+1,x+w-2,y+h-2,'g')
  for i,fy in enumerate(fl):
    sy=fy+FH-SL          # 이 층 슬래브(바닥) 위 끝
    # 창: 간격 13, 큰 창(두 짝)도 섞는다
    xs=list(range(B0+4,CF0-4,13))
    for j,x in enumerate(xs):
      if (i==0 and j in (3,)) or (i==1 and j==5):
        window(x,fy+3,11,13)
      else:
        window(x,fy+3,9,13)
    # 실외기(2층 난간 뒤)
    if i==2:
      for x in (24,37,63,89):
        rect(x,sy-6,x+5,sy-1,'A'); rect(x+1,sy-5,x+4,sy-2,'a'); px(x+2,sy-4,'m'); px(x+3,sy-3,'m')
    # 둥근 틀 안 창(3층·2층) / 4층은 이어서
    if i>0:
      window(CF0+4,fy+3,9,13); window(CF0+14,fy+3,7,13)
    else:
      window(CF0+3,fy+3,9,13); window(CF0+16,fy+3,9,13)
    # 흰 난간(높이 7): 위 막대·세로살·아래 막대
    top=sy-7
    hl(B0,B1 if i==0 else CF0+22,top,'H'); hl(B0,B1 if i==0 else CF0+22,top+1,'h')
    for x in range(B0,(B1 if i==0 else CF0+22)+1,3): vl(x,top+2,sy-1,'H' if x%6==0 else 'h')
    # 금속 슬래브(층 바닥) — 4층 것은 끝까지, 3·2층은 둥근 틀로
    rect(B0-1,sy,CF0,sy+SL-1,'M'); hl(B0-1,CF0,sy,'L'); hl(B0-1,CF0,sy+SL-1,'m')
    hl(B0,CF0,sy+SL,'r')  # 슬래브 그림자
  # 4층 슬래브는 계단탑까지 곧게
  sy4=fl[0]+FH-SL
  rect(CF0,sy4,B1,sy4+SL-1,'M'); hl(CF0,B1,sy4,'L'); hl(CF0,B1,sy4+SL-1,'m')

  # 둥근 틀(3층·2층): 위 슬래브에서 오른쪽 세로 띠로 내려와 아래 슬래브와 둥글게 만난다
  def cframe(fy):
    sy=fy+FH-SL
    x0,x1=CF0,CF0+28      # 틀 오른쪽 바깥 끝
    T=5                   # 세로 띠 두께
    top,bot=fy-SL,sy+SL-1
    ro,ri=5,4
    def inside_round(x,y,ax0,ay0,ax1,ay1,r):
      # 오른쪽 위·아래 모서리만 둥근 사각형
      if not(ax0<=x<=ax1 and ay0<=y<=ay1): return False
      for cx,cy in ((ax1-r,ay0+r),(ax1-r,ay1-r)):
        if (x>cx) and ((y<cy and cy==ay0+r) or (y>cy and cy==ay1-r)):
          if (x-cx)**2+(y-cy)**2 > r*r+r*0.8: return False
      return True
    # 오른쪽 벽돌 먼저(틀 밖)
    rect(x1+1,top,B1,bot,'R')
    for y in range(top,bot+1):
      if y%3==0: hl(x1+1,B1,y,'Q')
    for y in range(top,bot+1):
      for x in range(x0,x1+1):
        if inside_round(x,y,x0,top,x1,bot,ro) and not inside_round(x,y,x0-10,fy,x1-T,sy-1,ri):
          g[y][x]='M'
    # 그늘: 오른쪽 바깥 가장자리·아래 가장자리 어둡게, 위 가장자리 밝게
    for y in range(top,bot+1):
      xs=[x for x in range(x0,x1+1) if g[y][x]=='M']
      if xs and xs[-1]>x1-T-1: g[y][xs[-1]]='D'
    for x in range(x0,x1+1):
      ys=[y for y in range(top,bot+1) if g[y][x] in 'MD']
      if ys:
        if ys[-1]>=sy: g[ys[-1]][x]='m'
        g[ys[0]][x]='L' if ys[0]<fy else g[ys[0]][x]
    # 안쪽 세로 띠 그늘
    for y in range(fy,sy):
      for x in range(x1-T,x1-T+1):
        if g[y][x]=='M': g[y][x]='m'
  for fy in fl[1:]: cframe(fy)

  # ---- 지붕 띠(두껍게) + 옥상 난간(외곽선 뒤에 그림)
  rect(B0-1,ROOF,B1,ROOF+6,'M'); hl(B0-1,B1,ROOF,'L'); hl(B0-1,B1,ROOF+1,'L'); hl(B0-1,B1,ROOF+6,'D'); hl(B0-1,B1,ROOF+5,'m')

  # ---- 왼쪽 유리 계단실(살짝 뒤)
  rect(L0,ROOF+2,L1,BASE-1,'f')
  for y in range(ROOF+3,BASE-1):
    for x in range(L0+1,L1):
      g[y][x]='J' if ((y-ROOF)//7)%2==0 else 'j'
  for y in range(ROOF+3,BASE,7): hl(L0+1,L1-1,y,'f')
  vl(L0+6,ROOF+3,BASE-2,'f')
  for y in range(ROOF+5,BASE-1,7): px(L0+2,y,'i'); px(L0+3,y,'i')
  rect(L0,ROOF,L1+1,ROOF+2,'M'); hl(L0,L1+1,ROOF,'L')

  # ---- 오른쪽 계단탑: 유리 기둥 + 검은 돌
  rect(TG0,ROOF-2,TG1,BASE-1,'f')
  for y in range(ROOF-1,BASE-1):
    for x in range(TG0+1,TG1):
      g[y][x]='J' if ((y-ROOF)//9)%2==0 else 'j'
  for y in range(ROOF-1,BASE,9): hl(TG0+1,TG1-1,y,'f')
  for y in range(ROOF+1,BASE-1,9): px(TG0+2,y,'i'); px(TG0+3,y,'i'); px(TG0+2,y+1,'i')
  rect(TS0,ROOF-4,TS1,BASE-1,'S')
  for y in range(ROOF-4,BASE):
    for x in range(TS0,TS1+1):
      v=(x*13+y*7)%17
      if v==0: g[y][x]='s'
      elif v==5: g[y][x]='t'
  for y in range(ROOF+8,BASE,10): hl(TS0,TS1,y,'s')   # 돌 판 이음
  rect(TG0,ROOF-4,TS1,ROOF-3,'M'); hl(TG0,TS1,ROOF-4,'L')

  # ---- 1층: 캔틸레버 띠(계단탑까지), 초록 틀 창, 입구, 안내판, 계단·경사로
  rect(B0-1,GTOP,TS0-1,GTOP+4,'M'); hl(B0-1,TS0-1,GTOP,'L'); hl(B0-1,TS0-1,GTOP+4,'D'); hl(B0-1,TS0-1,GTOP+3,'m')
  gy=GTOP+5
  # 왼쪽 유리 계단실 아래도 벽돌 몸통과 같은 1층
  # 초록 틀 창(x 14~84)
  rect(14,gy+3,84,BASE-6,'T')
  for x0 in range(15,84,10):
    rect(x0,gy+4,x0+8,BASE-7,'g'); rect(x0,gy+4,x0+8,gy+9,'G'); hl(x0,x0+8,gy+10,'T')
    px(x0+1,gy+5,'i'); px(x0+2,gy+5,'i')
  # 기단 돌(창 아래)
  rect(12,BASE-5,86,BASE-1,'w'); hl(12,86,BASE-5,'W')
  for x in range(12,87,9): vl(x,BASE-4,BASE-1,'W')
  # 입구(x 96~116): 안쪽으로 들어간 유리문
  rect(94,gy,118,BASE-1,'F')
  rect(96,gy+2,105,BASE-4,'G'); rect(107,gy+2,116,BASE-4,'G')
  rect(96,gy+2,116,gy+3,'i'); vl(106,gy+2,BASE-4,'F'); px(104,gy+13,'H'); px(108,gy+13,'H')
  rect(98,gy+2,103,gy+6,'b')  # 문 위 안내 종이
  # 파란 안내판(입구 왼쪽 벽돌, 사진의 왼쪽 기둥)
  rect(88,gy+5,92,gy+13,'B'); rect(89,gy+6,91,gy+8,'b'); hl(89,91,gy+10,'b')
  # 계단 3단 + 경사로 난간(스테인리스)
  for k in range(3):
    rect(93-k*2,BASE-3+k,119+k*2,BASE-3+k,'w' if k%2==0 else 'W')
  for x in (86,90,122,126): vl(x,BASE-10,BASE-1,'h')
  hl(84,91,BASE-10,'H'); hl(121,128,BASE-10,'H'); hl(84,91,BASE-6,'h'); hl(121,128,BASE-6,'h')
  # 입구 오른쪽 벽돌의 작은 안내판(흰)
  rect(121,gy+4,126,gy+10,'F'); rect(122,gy+5,125,gy+9,'b')

  # 땅 기단 한 줄
  rect(L0,BASE,TS1,BASE+1,'w'); hl(L0,TS1,BASE+1,'W')

  # ---- 외곽선
  src=copy.deepcopy(g)
  for y in range(H):
    for x in range(W):
      if src[y][x]!='.': continue
      if any(0<=x+dx<W and 0<=y+dy<H and src[y+dy][x+dx]!='.' for dx,dy in ((1,0),(-1,0),(0,1),(0,-1))):
        g[y][x]='k'
  # 옥상 난간(하늘이 보이게 외곽선 뒤)
  for x in range(B0-2,B1+1,3): vl(x,ROOF-4,ROOF-1,'h')
  hl(B0-2,B1,ROOF-4,'H')

  while all(c=='.' for c in g[-1]): g.pop()
  img=Image.new('RGBA',(W,len(g)),(0,0,0,0))
  for y in range(len(g)):
    for x in range(W):
      c=P[g[y][x]]
      if c: img.putpixel((x,y),tuple(int(c[i:i+2],16) for i in (1,3,5))+(255,))
  return img
