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
    text=text.replace(/^\uFEFF?#target[^\n]*/m,'').replace('api.decide=decide;',
        'api.decide=decide;api.test={stats:stats,hue:hue,curvePoints:curvePoints,quality:quality,reduce:reduce};');
    var assertions=0;
    function assert(ok,msg){assertions++;if(!ok)throw Error('FAIL: '+msg);}
    function sample(colors) {
        var ys=[];for(var i=0;i<colors.length;i++){var c=colors[i];ys.push(.2126*c[0]+.7152*c[1]+.0722*c[2]);}
        return SOCHNO.test.stats({rgb:colors,y:ys,w:colors.length,h:1});
    }
    try {
        eval(text);
        var primaries=[[1,0,0],[1,1,0],[0,1,0],[0,1,1],[0,0,1],[1,0,1]],i;
        var six=sample(primaries);
        for(i=0;i<6;i++) {
            assert(SOCHNO.test.hue(primaries[i],1,0)===i*60,'hue '+i+' classified correctly');
            assert(six.bands[i].count===1,'each primary has its own color range');
        }
        var gray=sample([[.1,.1,.1],[.4,.4,.4],[.7,.7,.7],[.95,.95,.95]]),g=SOCHNO.decide(gray,1280);
        assert(g.vibrance===0&&g.saturation===0&&g.colorPresence===0,'neutral artwork stays neutral');
        for(i=0;i<6;i++)assert(g.colorBands[i].saturation===0&&g.colorBands[i].lightness===0,'neutral palette unchanged');
        var p=SOCHNO.decide(six,1280),tone=p.toneGuard,detail=p.detailGuard;
        SOCHNO.test.reduce(p,{white:false,black:false,color:true,saturation:true,bands:[true,false,false,false,false,false]});
        assert(p.colorGuard<1&&p.colorBands[0].guard<1,'color overflow is reduced');
        assert(p.toneGuard===tone&&p.detailGuard===detail,'color overflow preserves light and detail');
        var color=p.colorGuard;
        SOCHNO.test.reduce(p,{white:true,black:false,color:false,saturation:false,bands:[]});
        assert(p.toneGuard<tone&&p.detailGuard<detail,'tonal overflow reduces tonal effects');
        assert(p.colorGuard===color,'tonal overflow preserves color');
        six.noise=0;var clean=SOCHNO.decide(six,1280);
        six.noise=.025;var noisy=SOCHNO.decide(six,1280);
        assert(noisy.sharp<clean.sharp&&noisy.texture<clean.texture&&noisy.noiseOpacity>0,'noise reduces sharpening');
        var dull=sample([[.46,.38,.4],[.35,.4,.46],[.42,.46,.39]]);
        assert(SOCHNO.decide(dull,1280).vibrance>clean.vibrance,'dull images get more global color');
        var dark=sample([[.3,0,0],[.3,.3,0],[0,.3,0],[0,.3,.3],[0,0,.3],[.3,0,.3]]);
        assert(SOCHNO.decide(dark,1280).lift===32,'rich color does not reduce exposure recovery on dark images');
        for(var lift=-14;lift<=32;lift+=23)for(var guard=0;guard<=1;guard+=.5) {
            var pts=SOCHNO.test.curvePoints({lift:lift,contrast:39,toneGuard:guard});
            for(i=1;i<pts.length;i++)assert(pts[i][1]>pts[i-1][1]&&pts[i][1]<=255,'curve is monotonic and bounded');
        }
        assert(SOCHNO.test.quality(six,six).passed,'unchanged rendering passes');
        var bad=sample(primaries);bad.white=six.white+.02;
        assert(!SOCHNO.test.quality(six,bad).passed,'new white clipping fails');
        if(node)console.log('PASS '+assertions+' policy assertions');
        else $.writeln('PASS '+assertions+' policy assertions');
        return 'PASS '+assertions+' policy assertions';
    } finally {if(!node)$.global.SOCHNO_NO_AUTORUN=oldFlag;}
})(typeof $==='undefined'?null:$);
