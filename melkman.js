var Deque = require("collections/deque");
var convexHull = require("quick-hull-2d");
var _visibility = require("vishull2d");
var lineIntersection = require("segseg");
var ClipperLib = require("js-clipper");
var explanations = require("./explanation");

// Prototype extensions and helper functions - interesting code starts around line 170

//extend the deque to support peeking at the second item on either end
Deque.prototype.peek2 = function () {
    if (this.length < 2) {
        console.warn("Deque too small to peek2", this.toArray());
        return;
    }
    var index = (this.front + 1) & (this.capacity - 1);
    return this[index];
};

Deque.prototype.peekBack2 = function () {
    if (this.length < 2) {
        console.warn("Deque too small to peekBack2", this.toArray());
        return;
    }
    var index = (this.front + this.length - 2) & (this.capacity - 1);
    return this[index];
};

d3.selection.prototype.translate = function(a, b) {
  return arguments.length === 1 ?
        this.attr("transform", "translate(" + a + ")")
      : this.attr("transform", "translate(" + a + "," + b + ")");
};

// Wrapping node library functions - better than writing from scratch

function visibility(pts, cen){
    // convert vertex chain to line segments
    var segments = [
        [[0,0], [0,height]],
        [[0,height], [width,height]],
        [[width,height], [width, 0]],
        [[width, 0], [0,0]] ];
    for (var i = 0; i < pts.length; ++i) {
        var j = i+1;
        if (j === pts.length) j = 0;
        segments.push([pts[i], pts[j]]);
    }
    //console.log("basic ", segments);
    return _visibility(segments, cen);
}

function polygonIntersection(subject, clip){
    var cpr = new ClipperLib.Clipper(),
        solution_paths = new ClipperLib.Paths(),
        subject_fillType = ClipperLib.PolyFillType.pftNonZero,
        clip_fillType = ClipperLib.PolyFillType.pftNonZero;

    cpr.AddPaths([subject.map(function(p){return {X: p[0], Y: p[1]};})], ClipperLib.PolyType.ptSubject, true);
    cpr.AddPaths([clip.map(function(p){return {X: p[0], Y: p[1]};})], ClipperLib.PolyType.ptClip, true);
    cpr.Execute(ClipperLib.ClipType.ctIntersection, solution_paths, subject_fillType, clip_fillType);
    if (solution_paths.length === 0) return [];
    return solution_paths[0].map(function(obj){return [obj.X, obj.Y];});
}

// Geometry helpers

function leftTurn(p0, p1, p2){
    var a = p1[0] - p0[0],
        b = p1[1] - p0[1],
        c = p2[0] - p1[0],
        d = p2[1] - p1[1];
    return a*d - b*c < -0.001;
}

function rightTurn(p0, p1, p2){
    var a = p1[0] - p0[0],
        b = p1[1] - p0[1],
        c = p2[0] - p1[0],
        d = p2[1] - p1[1];
    return a*d - b*c > 0.001;
}

function dist2(p0, p1){
    var dx = p1[0] - p0[0],
        dy = p1[1] - p0[1];
    return (dx*dx) + (dy*dy);
}

function intersectsAny(p0, p1){
    var ret = 0;
    g_lines.selectAll(".err").remove();
    var j = points.length === 4 ? 3 : 4; // Don't ask
    for (var i = 0; i < points.length-j; i++){
        if (lineIntersection(p0, p1, points[i], points[i+1])){
            ret++;
            var q0 = points[i], q1 = points[i+1];
            g_lines.append("line")
                .attr("x1", q0[0])
                .attr("y1", q0[1])
                .attr("x2", q1[0])
                .attr("y2", q1[1])
                .attr("class", "err");
        }
    }
    return ret;
}

// Proceeding from p0 to p1, what point on the canvas boundary do you hit?
function toBoundary(p0, p1){
    var x = p1[0], y = p1[1],
        dx = x - p0[0],
        dy = y - p0[1];
    if (x===0 || y===0) return p1;
    var k, w;

    // left wall
    k = -x/dx;
    h = y + dy*k;
    if (k > 0 && h >= 0 && h <= height) return [0, h];

    // top wall
    k = -y/dy;
    w = x + dx*k;
    if (k > 0 && w >= 0 && w <= width) return [w, 0];

    // right wall
    k = (width-x)/dx;
    h = y + dy*k;
    if (k > 0 && h >= 0 && h <= height) return [width, h];

    // top wall
    k = (height-y)/dy;
    w = x + dx*k;
    if (k > 0 && w >= 0 && w <= width) return [w, height];

    console.warn("toBoundary found unsatisfactory result for", p0, p1);
    return p1;
}

// Given two points on boundary edges, return an array of points of the
// corners hit traveling clockwise
function corners(b0, b1){
    var top = 0, right = 1, bottom = 2, left = 3;

    sideOf = function(b){
        if (b[0]===0){
            return left;
        }else if (b[0]===width){
            return right;
        }else if (b[1]===0){
            return top;
        }else if (b[1]===height){
            return bottom;
        }else{
            console.warn("corners called with non-boundary point", b);
        }
    };

    var s0 = sideOf(b0), s1 = sideOf(b1);

    var cornerPoints = [[width,0], [width, height], [0,height], [0,0]];
    ret = [];

    while (s0 != s1){
        ret.push(cornerPoints[s0]);
        s0++;
        s0 %= 4;
    }

    return ret;
}

// initialize document margins

var margin = {top: 120, right: 20, bottom: 20, left: 400},
    width = window.innerWidth - margin.left - margin.right,
    height = window.innerHeight - margin.top - margin.bottom;

console.log("width", width, "height", height);

var alphabet = new Deque("abcdefghijklmnopqrstuvwxyz".split(""));

// inline styles?! Because CSS class transtitions didn't work.
var 
    cust_red = "#F46F6F", cust_blue = "#00BFFF", cust_green = "#01FF01", cust_yellow = "#FFFF84", 
    gray = "#DDD";

var transitionInLen = 600;
var transitionOutLen = 200;

// SVG initialization and g elements

var svg_deque = d3.select("#deque")
            .attr("width", width + margin.right)
            .attr("height", margin.top - 10);

var svg_polygon = d3.select("#polygon")
            .attr("width", width + margin.right)
            .attr("height", height + margin.bottom - 5);

d3.selectAll("svg").append("rect")
    .attr({width: width-2, x: 1, y: 1, class: "bg"})
    .attr("height", function(d,i){return i ? height : margin.top - 30;});

var g_deque = svg_deque.append("g")
    .translate((width - 60*4)/2, 0);

g_deque.append("line").attr("class", "hull");//only for finale line connected dequeue

var arrows = g_deque.append("line")//short line indicating convex points on the dequeue
    .attr({x2: 170, "marker-end": "url(#head)", class: "arrow", display: "none"})
    .translate(0, 75)
    .style("stroke", gray);

svg_deque.selectAll(".cover").data([0,0.5]).enter().append("rect")
    .attr({class: "cover", width: (width+margin.right)/2, height: margin.top})
    .attr("x", function(d){return d*(width+margin.right);});

var g_yellow = svg_polygon.append("g"),
    g_regions = svg_polygon.append("g"),
    g_lines  = svg_polygon.append("g"),
    g_points = svg_polygon.append("g");

g_lines.append("path").attr("class", "hull");//only for finale hull
g_lines.append("path").attr("id", "path_poly");//for path connect to points

var text = d3.select("#text");
text.html(explanations.intro);

// Sin Bin: Global state of the algorithm
var points = [];
var deque, lastOnHull, newPos;
var freeze = false;
var popping = false;
var validPoint = true;
var state = 0;

// Functions to handle the polygon drawing
var line_gen = d3.svg.line();
function line(){
    return g_lines.select("#path_poly").datum(points).attr("d", line_gen);
}

function updatePoint(p){
    var sel = g_points.select("#newest");
    if (sel.size()){
        p.s = sel.datum().s;
        sel.translate(p).datum(p);
    }
    return sel;
}

function mousePoint(p){
    // console.log("g_points", g_points);
    var sel = g_points.select("#newest");
    if (sel.size()){
        //console.log("sel", sel);
        updatePoint(p);
        points[points.length-1] = p;
    }else{
        console.log("state:",state);
        p.s = alphabet.shift();
        points.push(p);
        console.log("points", points);
        var g = g_points.append("g").attr("id", "newest").attr("class", "hull-vertex").translate(p).datum(p);
        var fill = points.length > 3 ? gray : "white";
        g.append("circle").attr("r", 10).style({fill: fill, stroke: "black"});
        g.append("text").text(p.s).attr("dy", "4px").style("font-size", "14px");
        return g;
    }
}

function hullPoint(p){
    updatePoint(p).attr("id", null);
}

function interiorPoint(p){
    console.log("276",p);
    updatePoint(p).attr("id", null);
    return hullToInterior(p);
    


}

function hullToInterior(p){
    console.log("1.",alphabet);
    alphabet.unshift(p.s);
    //alphabet.push(p.s);
    console.log("after push", alphabet);
    var point = g_points.selectAll(".hull-vertex")
        .filter(function(d){return d.s===p.s;})
        .attr("class", "interior-vertex")
        .transition().duration(1100);
    point.select("circle")
        .attr("r", 4)
        .style({fill: "black", stroke: "0px"});
    point.select("text")
        .attr("dy", "0px")
        .style("font-size", "0px")
        .remove();
}

// Functions to handle specific moments in the presentation

function first3(){
    freeze = true;
    state = 1;
    text.html(explanations.okayStop);
    var a = points[0], b = points[1], c = points[2];
}

function revealDeque(){
    state++;
    text.html(explanations.dequeIntro);
    var a = points[0], b = points[1], c = points[2];
    lastOnHull = c;
    if (leftTurn(a,b,c)){
        deque = new Deque([b,a]);
    }else{
        deque = new Deque([a,b]);
    }
    renderDeque();
    svg_deque.selectAll(".cover").transition()
        .duration(1000)
        .attr("x", function(d,i){
            return i ? width+margin.right+10 : -(width+margin.right)/2 -10;
        })
        .remove();
}

function pointC(){
    state++;
    var a = points[0], b = points[1], c = points[2];
    var initialLeftTurn = leftTurn(a,b,c);
    text.html(explanations.pointC(initialLeftTurn));
    renderFills();
    renderDeque();
}

// Main rendering functions

function renderDeque(){
    // Fair warning: this is the ugliest function in the project
    var data = !popping ? [lastOnHull].concat(deque.toArray(), [lastOnHull])
                        : [newPos].concat(deque.toArray(), [newPos]);
    if (!popping){
        console.log("deque is", data.map(function(d){return d.s;}));
        g_deque.transition().duration(750)
            .attr("transform", "translate("+((width - 60*data.length)/2)+",0)");
    }
    var items = g_deque.selectAll(".deque-vertex")
        .data(data, function(d,i){
            if (newPos && d.s === newPos.s) return d.s + (i < data.length/2 ? 0 : 1);
            if (d.s === lastOnHull.s) return d.s + (i < data.length/2 ? 0 : 1);
            return d.s;
        });
    var entering = items.enter().append("g").attr("class", "deque-vertex")
        .attr("transform", function(d,i){
            var j = state == 2 ? i : i - 1;
            return "translate("+(j*60)+","+(margin.top / 2 - 35)+")";});
    entering.append("rect")
        .attr({width: "40px", height: "40px", rx: "8px", ry: "8px", x: "0px", y: "0px"})
        .style("fill", state == 2 ? "white" : gray);
    entering.append("text")
        .translate(20,20)
        .attr("dy", "5px");
    items.selectAll("text").text(function(d){return d.s;});
    items.order();
    var exiting = items.exit().transition().duration(800).ease("cubic");
    exiting.select("rect").attr({width: 0, height: 0, x: "20px", y: "20px", rx: "0px", ry: "0px"});
    exiting.select("text").style("font-size", 0).attr("dy", "0px");
    exiting.remove();
    var lastIndex;
    exiting.each("end", function(){
        g_deque.selectAll(".deque-vertex")
            .call(function(){lastIndex = this.size() - 1;})
            .transition()
            .attr("transform", function(d,i){
                var transform = d3.transform(d3.select(this).attr("transform"));
                if (state === 20 && i !== 0) transform.translate[0] -= 60;
                if (state === 21 && i !== lastIndex) transform.translate[0] += 60;
                return transform.toString();
            });
    });

    // arrows, the gray line indicating the side of the deque
    if (state == 20){
        arrows.attr("display", null).translate(-60, 75);
    }else if (state == 21){
        var x = d3.transform(items.filter(function(d,i){return i===items.size()-1;}).attr("transform")).translate[0];
        arrows.attr("display", null).translate(x-120, 75);
    }else{
        arrows.attr("display", "none");
    }

    if (!popping && state > 2 && state != 7){
    lastIndex = items.size() - 1;
    items.transition()
        .attr("transform", function(d,i){return "translate(" + (i*60) + ","+ (margin.top / 2 - 35)+")";})
        .select("rect")
        .style("fill", function(d,i){
                        if (i === 0 || i === lastIndex) { return cust_blue; }
                        if (i === 1) { return cust_green; }
                        if (i === lastIndex-1) { return cust_red; }
                        return "white";
        });
    }
}

function renderFills(){
    svg_polygon.selectAll(".hull-vertex circle")
        .transition()
        .style("fill", function(d,i){
                        if (d.s === lastOnHull.s) { return "red"; }
        })
        .transition()
        .style("fill", function(d){
                        if (d.s === lastOnHull.s) { return cust_blue; }
                        if (d.s === deque.peek().s) { return cust_green; }
                        if (d.s === deque.peekBack().s) { return cust_red; }
                        return "white";
        });

}

function rbpRegions(){
    //rbp = red, blue, purple
    state++;
    text.html(explanations.rbpRegions);
    renderRBPregions();
}

function renderRBPregions(){
    g_regions.selectAll("path.region").transition().duration(transitionOutLen)
        .style("fill", "white")
        .remove();
    console.log("in fucntion", points);
    var visible = visibility(points, points[points.length-1]);
    console.log("visible RBP regions is",visible);
    var region = function(order, color, p1, p2, p3, p4){
        var b0 = toBoundary(p1, p2),
            b1 = toBoundary(p3, p4),
            regionOutline = convexHull([b0, lastOnHull, b1].concat(corners(b0, b1)));
            outline = polygonIntersection(visible, regionOutline);
        g_regions.append("path")
            .datum(outline)
            .attr("d", line_gen)
            .attr("class", "region")
            .style("fill", "white")
          .transition()
            .duration(transitionInLen)
            .delay(order*transitionInLen + transitionOutLen)
            .style("fill", color);
    };
    var p_r = deque.peek();
    var p_b = deque.peekBack();
    var p_p = lastOnHull;
    region(0, cust_red,   p_p, p_b, p_r, p_p);
    region(1, cust_green,    p_b, p_p, p_p, p_r);
    region(2, cust_blue, p_r, p_p, p_b, p_p);
}

function yellowRegion(){
    state++;
    freeze = false;
    text.html(explanations.yellowRegion);
    renderYellowRegion();
}

function renderYellowRegion(){
    g_yellow.selectAll("path").transition().duration(transitionOutLen)
        .style("fill", "white")
        .remove();

    g_yellow.append("path")
        .datum(visibility(points, points[points.length-1]))
        .attr("d", line_gen)
        .style("fill", "white")
        .attr("class", "region")
      .transition().duration(transitionInLen).delay(state===5 ? 0 : 3*transitionInLen)
        .style("fill", "yellow");
}

function renderDashedLines(){
    var data = [[deque.peek(), toBoundary(deque.peek2(), deque.peek())],
                [deque.peekBack(), toBoundary(deque.peekBack2(), deque.peekBack())]];
    var lines = g_lines.selectAll("line.dashed")
        .data(data)
    lines.enter().append("line").attr("class", "dashed");
    lines.attr("x1", function(d){return d[0][0];})
        .attr("y1", function(d){return d[0][1];})
        .attr("x2", function(d){return d[1][0];})
        .attr("y2", function(d){return d[1][1];})
        .style("stroke-opacity", 0)
      .transition().duration(transitionInLen).delay(4*transitionInLen)
        .style("stroke-opacity", 1);
    lines.exit().remove();
}

// Determine region and handle new point

function newPoint(pos){
    freeze = true;
    var r_green = rightTurn(deque.peek(), lastOnHull, pos);
    var r_red = leftTurn(deque.peekBack(), lastOnHull, pos);
    console.log("green:", r_green, "red:", r_red);

    if (!r_green && !r_red){
        interiorPoint(pos);
        points.push(pos);
        line();
        text.html(explanations.pointInYellow);
        // renderYellowRegion();
        // renderRBPregions();
        freeze = false;
        state = 7;
    }else{
        if (r_green && !r_red){
            text.html(explanations.pointInGreen);
        }else if (!r_green && r_red){
            text.html(explanations.redLeft);
        }else{
            text.html(explanations.pointInBlue);
        }
        newPos = pos;
        hullPoint(pos);
        points.push(pos);
        line();
        deque.push(lastOnHull);
        deque.unshift(lastOnHull);
        popping = true;
        state = 20;
        renderDeque();
    }
    console.log("newPoint",points);
}

function fixLeft(){
    if (rightTurn(deque.peek2(), deque.peek(), newPos)){
        var removed = deque.shift();
        console.log("shifting", removed);
        if (removed.s !== deque.peekBack().s){
            hullToInterior(removed);
        }
        renderDeque();
    }else{
        state = 21;
        renderDeque();
        if (leftTurn(deque.peekBack2(), deque.peekBack(), newPos)){
            if (text.text().indexOf("purple") == -1){
                text.html(explanations.pointInRed);
            }
            fixRight();
        }else{
            text.html(explanations.greenRight);
        }
    }
}

function fixRight(){
    if (leftTurn(deque.peekBack2(), deque.peekBack(), newPos)){
        var removed = deque.pop();
        console.log("popping", removed);
        if (removed.s !== deque.peek().s){
            hullToInterior(removed);
        }
        renderDeque();
    }else{
        text.html(explanations.donePopping);
        lastOnHull = newPos;
        newPos = undefined;
        popping = false;
        state = 6;
        renderDeque();
        renderFills();
        renderRBPregions();
        renderYellowRegion();
        renderDashedLines();
        freeze = false;
    }
}

function finished(){
    state = 30;
    freeze = true;
    text.html(explanations.finished);
    g_points.select("#newest").remove();
    points[points.length-1] = points[0];
    line();
    svg_polygon.selectAll("path.region").transition().duration(500)
        .style("fill", "white")
        .remove();
    g_lines.selectAll(".err, .dashed").remove();
    g_lines.select(".hull")
        .attr("d", line_gen([lastOnHull].concat(deque.toArray(), [lastOnHull])))
        .attr("class", "hull")
        .style("stroke-opacity", 0)
        .transition().duration(750)
        .style("stroke-opacity", 1);
    g_deque.select(".hull")
        .attr("x1", 30)
        .attr("x2", (deque.length+1.3)*60)
        .attr("y1", margin.top/2 - 15)
        .attr("y2", margin.top/2 - 15)
        .style("stroke-opacity", 0)
        .transition().duration(750)
        .style("stroke-opacity", 1);
}
function finale(){
    state = 31;
    text.html(explanations.finale);
}

// Finally, the driving event dispatchers

svg_polygon.on("click", function(){
    if (freeze) return;
    var pos = points[points.length-1];
    console.log("here",points);
    // check finish condition before nonsimple condition
    if (points.length > 3 && dist2(pos, points[0]) < 600) return finished();
    if (!validPoint) return;
    if (points.length > 1){
        var prev = points[points.length-2];
        if (dist2(pos, prev) < 400) return;//if you click too close, you can not put the point on
    }
    if (points.length > 3) return newPoint(pos);
    hullPoint(pos);
    line();
    if (points.length === 3) first3();
});

function adjustPosition(p){
    var x = p[0]-7, y = p[1]-7;
    x = Math.max(12, Math.min(x, width-10));
    y = Math.max(12, Math.min(y, height-10));
    return [x,y];
}

svg_polygon.on("mousemove", function(){
    if (freeze) return;
    var pos = adjustPosition(d3.mouse(svg_polygon.node()));
    if (points.length > 3){
        var prev = points[points.length-2],
            numberIntersections = intersectsAny(prev, pos);
        if (numberIntersections){
            text.html(explanations.nonsimple(numberIntersections));
            validPoint = false;
        }else if (!validPoint){
            validPoint = true;
            if (state === 5) text.html(explanations.yellowRegion);
            if (state === 6) text.html(explanations.donePopping);
            if (state === 7) text.html(explanations.pointInYellow);
        }
    }
    mousePoint(pos);
    line();
});

d3.select("body").on("keydown", function(){
    var transitioning = svg_deque.selectAll(".deque-vertex")[0].some(function(node){return !!node.__transition__;});
    if (transitioning) return;
    if (d3.event.keyCode == 32){
        switch (state){
            case 1:
                revealDeque();
            break;
            case 2:
                pointC();
            break;
            case 3:
                rbpRegions();
            break;
            case 4:
                yellowRegion();
            break;
            case 20:
                fixLeft();
            break;
            case 21:
                fixRight();
            break;
            case 30:
                finale();
            break;
            default:
        }
    }
});
