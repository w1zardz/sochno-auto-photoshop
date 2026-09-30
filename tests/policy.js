/* Run with node tests/policy.js, or File > Scripts > Browse in Photoshop.
   No document changes. Also run in ExtendScript: its parser differs from modern JS. */
(function (runtime) {
    var node=typeof require==='function',text,oldFlag;
    var $=runtime||{global:{SOCHNO_NO_AUTORUN:true}};
    if(node)text=require('fs').readFileSync(require('path').join(__dirname,'../SOCHNO_AUTO.jsx'),'utf8');
    else {
        var file=File(File($.fileName).parent.parent+'/SOCHNO_AUTO.jsx');
        file.encoding='UTF8';if(!file.open('r'))throw Error('Cannot read SOCHNO_AUTO.jsx');
        text=file.read();file.close();oldFlag=$.global.SOCHNO_NO_AUTORUN;$.global.SOCHNO_NO_AUTORUN=true;
    }
    var charIDToTypeID=function(v){return v;},stringIDToTypeID=function(v){return v;};
    // Expose pure functions only in the test copy; production API stays small.
    text=text.replace(new RegExp('^'+String.fromCharCode(0xFEFF)+'?#target[^'+String.fromCharCode(10)+']*','m'),'').replace('api.decide=decide;',
        'api.decide=decide;api.test={stats:stats,hue:hue,quality:quality,reduce:reduce,merged:merged,copy:copy,titleBox:titleBox};');
    var assertions=0;
    function assert(ok,msg){assertions++;if(!ok)throw Error('FAIL: '+msg);}
    function sample(colors) {
        var ys=[];for(var i=0;i<colors.length;i++){var c=colors[i];ys.push(.2126*c[0]+.7152*c[1]+.0722*c[2]);}
        return SOCHNO.test.stats({rgb:colors,y:ys,w:colors.length,h:1});
    }
    // A full-resolution measurement as measure() returns it.
    function metrics(o) {
        var m={crush:.01,clip:.05,white:.01,chroma:.3,mean:.45,p01:.02,p50:.42,p99:.97,minP05:0,
            lostShadows:0,lostColor:0,lostWhite:0,neutral:{c:.02,share:.05},skin:{c:0,share:0}};
        for(var k in o)if(o.hasOwnProperty(k))m[k]=o[k];
        return m;
    }
    function keysAreIds(settings) {
        for(var k in settings)if(settings.hasOwnProperty(k)&&k.length!==4)return false;
        return true;
    }
    try {
        eval(text);
        var primaries=[[1,0,0],[1,1,0],[0,1,0],[0,1,1],[0,0,1],[1,0,1]],i;
        var six=sample(primaries);
        for(i=0;i<6;i++) {
            assert(SOCHNO.test.hue(primaries[i],1,0)===i*60,'hue '+i+' classified correctly');
            assert(six.bands[i].count===1,'each primary has its own color range');
        }
        var gray=sample([[.1,.1,.1],[.4,.4,.4],[.7,.7,.7],[.95,.95,.95]]),g=SOCHNO.decide(gray,metrics({chroma:0}),1280);
        assert(g.color.vibrance===0&&g.color.saturation===0&&g.presence===0,'neutral artwork stays neutral');
        for(i=0;i<6;i++)assert(g.color.bands[i]===0,'neutral palette unchanged');
        assert(g.base.STSS===0&&g.base.HA_G===0&&g.base.LA_B===0,'no colour grading on monochrome');
        var p=SOCHNO.decide(six,metrics({}),1280);
        // Every Camera Raw key must be a four-character ID ("LNR " has a trailing space).
        six.noise=.03;var noisy=SOCHNO.decide(six,metrics({}),1280);six.noise=0;
        assert(keysAreIds(p.base)&&keysAreIds(p.detail)&&keysAreIds(noisy.detail),'Camera Raw keys are four-character IDs');
        assert(noisy.detail['LNR ']>0,'noise enables Camera Raw luminance noise reduction');
        assert(noisy.detail.Shrp<p.detail.Shrp&&noisy.detail.CrTx<p.detail.CrTx&&noisy.detail.ShpM>p.detail.ShpM,'noise reduces sharpening and texture, raises edge masking');
        for(i=0;i<6;i++)assert(p.color.bands[i]>=0&&p.color.bands[i]<=20,'colour ranges are boosted or left alone, never desaturated');
        assert(p.color.bands[0]<=10,'reds, which carry skin, stay gentle');
        var dull=sample([[.46,.38,.4],[.35,.4,.46],[.42,.46,.39]]);
        assert(SOCHNO.decide(dull,metrics({}),1280).color.vibrance>p.color.vibrance,'dull images get more global colour');
        assert(SOCHNO.decide(dull,metrics({}),1280).colorCeiling>p.colorCeiling,'muted images may gain more chroma before the ceiling');
        // Dense neon artwork is not brightened or shadow-lifted like a dull photo of the same brightness.
        var neon=SOCHNO.decide(sample([[.9,.1,.9],[.1,.2,.95],[.95,.75,.05],[.05,.05,.1],[.6,0,.8],[.1,.9,.9]]),metrics({}),1280);
        var muted=SOCHNO.decide(sample([[.5,.35,.5],[.35,.4,.55],[.55,.5,.35],[.25,.25,.28],[.45,.3,.5],[.35,.5,.5]]),metrics({}),1280);
        assert(neon.base.Ex12===0&&muted.base.Ex12>neon.base.Ex12,'neon keeps its dark density, a muted image is still lifted');
        // Same luminance as the neon sample, without colour: its shadows are lifted like a dull photo.
        var greyNeon=SOCHNO.decide(sample([[.328,.328,.328],[.233,.233,.233],[.742,.742,.742],[.054,.054,.054],[.185,.185,.185],[.73,.73,.73]]),metrics({}),1280);
        assert(neon.base.Sh12<10&&greyNeon.base.Sh12>2*neon.base.Sh12,'neon shadows are not lifted into grey');
        var bright=SOCHNO.decide(sample([[.95,.9,.85],[.9,.92,.95],[.8,.85,.9],[.97,.97,.97]]),metrics({mean:.85,p99:1,white:.3,clip:.4}),1280);
        assert(bright.base.Ex12>=0,'exposure never dims a bright thumbnail');
        assert(bright.base.Hi12===0&&bright.base.Wh12===0,'clipped whites (text, UI) keep their full brightness');
        var glow=SOCHNO.decide(sample([[.9,.88,.86],[.86,.87,.9],[.88,.9,.87],[.3,.3,.3]]),metrics({white:0,clip:0,p99:.93}),1280);
        assert(glow.base.Hi12<0,'bright detail that is not clipped yet is recovered');
        var flatMid=SOCHNO.decide(sample([[.4,.4,.42],[.45,.44,.43],[.5,.5,.49]]),metrics({p99:.6}),1280);
        assert(flatMid.base.Wh12>0,'an image without a white point gets one');
        assert(SOCHNO.decide(six,metrics({p01:.12}),1280).base.Bk12<0,'lifted blacks are deepened');
        assert(SOCHNO.decide(six,metrics({crush:.12}),1280).base.Bk12>0,'crushed blacks are opened');
        assert(SOCHNO.decide(six,metrics({minP05:.2}),1280).base.Dhze>SOCHNO.decide(six,metrics({}),1280).base.Dhze,'haze gets dehaze');
        // Quality gate on full-resolution metrics.
        var before=metrics({}),same=metrics({});
        assert(SOCHNO.test.quality(before,same,p).passed,'unchanged rendering passes');
        assert(!SOCHNO.test.quality(before,metrics({lostShadows:.007}),p).passed,'shadow detail crushed to black fails');
        assert(!SOCHNO.test.quality(before,metrics({lostColor:.025}),p).passed,'2.5% of the frame newly clipped fails');
        assert(SOCHNO.test.quality(before,metrics({lostColor:.015}),p).passed,'1.5% newly clipped is tolerated');
        assert(!SOCHNO.test.quality(before,metrics({lostWhite:.007}),p).passed,'detail blown to white fails');
        assert(SOCHNO.test.quality(before,metrics({clip:.2,white:.2}),p).passed,'near-white areas turning white are not a loss');
        assert(!SOCHNO.test.quality(before,metrics({neutral:{c:.03,share:.05}}),p).passed,'tinted whites fail');
        assert(SOCHNO.test.quality(before,metrics({neutral:{c:.012,share:.05}}),p).passed,'cleaner whites pass');
        var withSkin=metrics({skin:{c:.3,share:.04}});
        assert(!SOCHNO.test.quality(withSkin,metrics({skin:{c:.36,share:.04}}),p).passed,'oversaturated skin fails');
        assert(SOCHNO.test.quality(before,metrics({skin:{c:.5,share:0}}),p).passed,'no faces, no skin check');
        assert(!SOCHNO.test.quality(before,metrics({mean:.40}),p).passed,'a darker result fails');
        var high=SOCHNO.test.quality(before,metrics({chroma:.3*(1+p.colorCeiling+.05)}),p);
        assert(high.passed&&high.colorHigh,'too much colour is retuned but is not a hard failure');
        // Guards act on their own cause only.
        var r=SOCHNO.decide(six,metrics({}),1280),tone=SOCHNO.test.copy(r);
        SOCHNO.test.reduce(r,{crush:true});
        assert(r.base.Bk12>tone.base.Bk12&&r.base.Sh12>tone.base.Sh12&&r.base.Cr12<tone.base.Cr12,'crush opens shadows and lowers contrast');
        assert(r.colorScale===tone.colorScale,'crush leaves colour alone');
        var c=SOCHNO.decide(six,metrics({}),1280);SOCHNO.test.reduce(c,{colorHigh:true,gain:c.colorCeiling*1.5});
        assert(c.colorScale<1&&c.base.Cr12===tone.base.Cr12&&c.detail.CrTx===tone.detail.CrTx,'too much colour lowers colour only');
        var cl=SOCHNO.decide(six,metrics({}),1280),again=SOCHNO.test.reduce(cl,{clip:true});
        assert(cl.colorScale<1&&cl.base.Hi12===tone.base.Hi12&&!again,'first new clipping lowers colour only, without another Camera Raw pass');
        again=SOCHNO.test.reduce(cl,{clip:true});
        assert(again&&cl.base.Hi12<tone.base.Hi12&&cl.base.Cr12<tone.base.Cr12,'persistent clipping lowers contrast and recovers highlights');
        var wh=SOCHNO.decide(six,metrics({}),1280);
        assert(SOCHNO.test.reduce(wh,{white:true})&&wh.base.Cr12<tone.base.Cr12&&wh.colorScale===1,'new white clipping is a tone problem, not a colour one');
        var nt=SOCHNO.decide(six,metrics({}),1280);
        assert(!SOCHNO.test.reduce(nt,{neutral:true}),'cleaning whites harder needs no Camera Raw pass');
        var n=SOCHNO.decide(six,metrics({}),1280),n0=n.neutral;SOCHNO.test.reduce(n,{neutral:true});
        assert(n.neutral<n0&&n.neutral>=-90,'tinted whites are cleaned harder, within limits');
        for(i=0;i<5;i++)SOCHNO.test.reduce(c,{colorHigh:true,gain:1});
        assert(c.colorScale>=.2,'colour never drops below a floor through repeated retunes');
        // Foliage: grass and leaves get less Vibrance and gentler yellow/green ranges; reds are unaffected.
        var leaves=sample([[.55,.55,.2],[.45,.55,.2],[.35,.5,.15],[.6,.58,.25],[.9,.1,.1],[.2,.4,.9]]);
        var clean=sample([[.3,.3,.33],[.33,.3,.3],[.32,.34,.32],[.4,.4,.42],[.9,.1,.1],[.2,.4,.9]]);
        assert(leaves.foliage>.5&&clean.foliage===0,'grass tones are recognised as foliage, greys are not');
        var lp=SOCHNO.decide(leaves,metrics({}),1280);leaves.foliage=0;var lp0=SOCHNO.decide(leaves,metrics({}),1280);
        assert(lp.color.vibrance<lp0.color.vibrance,'foliage-heavy frames get less Vibrance');
        assert(lp.color.bands[1]<=6&&lp.color.bands[2]<=6,'yellow and green ranges stay gentle on foliage');
        assert(lp.color.bands[0]===lp0.color.bands[0]&&lp.color.bands[4]===lp0.color.bands[4],'reds and blues keep their boost');
        // Title: bright letters with a dark outline are found; clouds without an outline are not.
        function frame(w,h,bg,paint) {
            var rgb=[],ys=[];
            for(var y=0;y<h;y++)for(var x=0;x<w;x++){var c=paint(x,y)||bg;rgb.push(c);ys.push(.2126*c[0]+.7152*c[1]+.0722*c[2]);}
            return {rgb:rgb,y:ys,w:w,h:h};
        }
        var grass=[.55,.55,.25],yellow=[1,.85,0],ink=[.02,.02,.02];
        var titled=frame(64,36,grass,function(x,y){
            if(y>=26&&y<=33&&x>=8&&x<=40)return (y===26||y===33||x===8||x===40||x%6===0)?ink:yellow;
        });
        var tb=SOCHNO.test.titleBox(titled);
        assert(tb&&tb.y0>.65&&tb.y1<=1&&tb.x0<.2&&tb.x1<.7,'title band found at the bottom');
        assert(tb.backdrop>.4,'bright grass backdrop measured behind the title');
        var cloudy=frame(64,36,[.35,.55,.85],function(x,y){if(y>=4&&y<=12&&x>=10&&x<=30)return [.95,.95,.97];});
        assert(SOCHNO.test.titleBox(cloudy)===null,'clouds are not a title');
        var ts=sample([[.5,.5,.3]]);ts.title=tb;
        var tp=SOCHNO.decide(ts,metrics({}),1280);
        assert(tp.title&&tp.title.dim>=.12&&tp.title.dim<=.27,'bright backdrop behind the title is dimmed within limits');
        ts.title={x0:0,y0:.7,x1:.5,y1:1,share:.02,backdrop:.15};
        assert(SOCHNO.decide(ts,metrics({}),1280).title===null,'a dark backdrop is left alone');
        assert(SOCHNO.decide(six,metrics({}),1280).title===null,'no title, no title layer');
        var tcp=SOCHNO.test.copy(tp);tcp.title.dim=.9;
        assert(tp.title.dim!==.9,'title settings are copied with snapshots');
        var cp=SOCHNO.test.copy(r);cp.base.Bk12=99;
        assert(r.base.Bk12!==99,'parameter snapshots do not share settings');
        if(node)console.log('PASS '+assertions+' policy assertions');
        else $.writeln('PASS '+assertions+' policy assertions');
        return 'PASS '+assertions+' policy assertions';
    } finally {if(!node)$.global.SOCHNO_NO_AUTORUN=oldFlag;}
})(typeof $==='undefined'?null:$);
