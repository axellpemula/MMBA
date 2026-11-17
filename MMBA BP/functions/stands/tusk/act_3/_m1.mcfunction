# --- Tusk Act 3 primary nail (fire 0.40s = F8, interval 0.35s = I7, L=15) -- see scripts/stands/tusk/TUSK.md
# click
scoreboard players add @s[scores={sp1=19,nails=1..,sneak=0},tag=!onSkill,tag=!tusk_rotation,tag=!tusk_detached,tag=!tusk_spatial] m1 1
scoreboard players set @s[scores={m1=3..}] m1 2
tag @s[scores={sp1=19,nails=1..,sneak=0},tag=!onSkill,tag=!tusk_rotation,tag=!tusk_detached,tag=!tusk_spatial] add tusk_shot_queued
playanimation @s[scores={sp1=19,m1=1,nails=1..,sneak=0},tag=!onSkill,tag=!tusk_rotation,tag=!tusk_detached,tag=!tusk_spatial] animation.tusk3.nail
playanimation @s[scores={sp1=19,m1=2,nails=1..,sneak=0},tag=!onSkill,tag=!tusk_rotation,tag=!tusk_detached,tag=!tusk_spatial] animation.tusk3.nail2
execute as @s[scores={sp1=19,nails=1..,sneak=0},tag=!onSkill,tag=!tusk_rotation,tag=!tusk_detached,tag=!tusk_spatial] at @s run playsound xvoid.steelball_turn2 @a[r=20] ~~~ 0.6 0.8
execute as @s[scores={sp1=19,m1=1,nails=1..,sneak=0},tag=!onSkill,tag=!tusk_rotation,tag=!tusk_detached,tag=!tusk_spatial] at @s run playsound johnny.atkJM_01 @a[r=20] ~~~ 0.85 1.0
execute as @s[scores={sp1=19,m1=2,nails=1..,sneak=0},tag=!onSkill,tag=!tusk_rotation,tag=!tusk_detached,tag=!tusk_spatial] at @s run playsound johnny.atkSM_02 @a[r=20] ~~~ 0.75 1.0
scoreboard players set @s[scores={sp1=19,nails=1..,sneak=0},tag=!onSkill,tag=!tusk_rotation,tag=!tusk_detached,tag=!tusk_spatial] sp1 -15

# fire (sp1 == -I) — only when queued by an actual click
execute as @s[scores={sp1=-7,nails=1..},tag=tusk_shot_queued] at @s run playsound xvoid.hit_slash_S @a[r=20] ~~~ 0.9 0.9
execute as @s[scores={sp1=-7,nails=1..},tag=tusk_shot_queued] at @s run playsound xvoid.oramuda_button2 @a[r=20] ~~~ 0.7 0.9
camerashake add @s[scores={sp1=-7,nails=1..},tag=tusk_shot_queued] 0.1 0.08
execute as @s[scores={sp1=-7,nails=1..},tag=tusk_shot_queued] at @s run scriptevent xvoid:tusk_shot primary 3
tag @s[scores={sp1=-7}] remove tusk_shot_queued

# open spam window before sp1 reaches 0 (0 wipes m1)
scoreboard players set @s[scores={sp1=-1,m1=1..}] sp1 8
tag @s[scores={sp1=0}] remove tusk_shot_queued

