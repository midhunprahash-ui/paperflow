import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PaperMarkdown } from "./paper-markdown";
import { PaperReader, buildHeadingOutline } from "./paper-reader";
import { demoPaper } from "@/lib/demo";
import type { HeadingNode, PaperDocument } from "@/lib/types/document";

afterEach(cleanup);
describe("research content rendering", () => {
  it("renders nested Markdown lists with their original start number and inline formatting", () => {
    const { container } = render(<PaperMarkdown text={'3. **Prepare** the data\n4. Fit the model\n   - Use `random_state`\n   - Report *uncertainty*\n\n[Read the source](https://example.com/paper)'} />);
    expect(container.querySelector("ol")).toHaveAttribute("start", "3");
    expect(container.querySelector("ol ul")).not.toBeNull();
    expect(container.querySelector("strong")).toHaveTextContent("Prepare");
    expect(container.querySelector("em")).toHaveTextContent("uncertainty");
    expect(container.querySelector("code")).toHaveTextContent("random_state");
    expect(screen.getByRole("link", { name: "Read the source" })).toHaveAttribute("href", "https://example.com/paper");
  });
  it("renders GFM tables, inline and display math, without interpreting fenced code as math", () => {
    const { container } = render(<PaperMarkdown text={'The score is $x^2 + y^2$.\n\n$$\n\\sum_{i=1}^{n} x_i\n$$\n\n| Model | F1 |\n| --- | --- |\n| **Baseline** | 0.81 |\n\n```python\nvalue = "$literal$"\n```'} />);
    expect(screen.getByRole("columnheader", { name: "Model" })).toBeVisible();
    expect(container.querySelectorAll(".katex-mathml")).toHaveLength(2);
    expect(container.querySelector(".paper-math-block .katex-display")).not.toBeNull();
    expect(container.querySelector("pre code")).toHaveTextContent('value = "$literal$"');
  });
  it("keeps inline formatting inside valid paragraph markup and escapes untrusted HTML", () => {
    const { container } = render(<p><PaperMarkdown text={'**Safe** $x_1$ [bad](javascript:alert) <img src=x onerror=alert(1)> <script>alert(1)</script>'} inline /></p>);
    expect(container.querySelector("p p")).toBeNull();
    expect(container.querySelector(".katex-mathml")).not.toBeNull();
    expect(container.querySelector("script,img,[onerror]")).toBeNull();
    expect(container.querySelector("a")).not.toHaveAttribute("href", "javascript:alert");
  });
  it("keeps invalid or untrusted LaTeX readable instead of rendering executable markup", () => {
    const { container } = render(<PaperMarkdown text={'$\\unknowncommand{x}$ and $\\href{javascript:alert(1)}{click}$'} />);
    expect(container.querySelector(".math-fallback")).toHaveTextContent("\\unknowncommand");
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
  });
  it("preserves Roman, alphabetic, decimal, and explicit parser hierarchy", () => {
    const labels = ['I. I NTRODUCTION','II. R ELATED WORKS','III. Methods','A. Dataset','1) Sampling','2) Evaluation','B. Results','IV. Discussion','4.1 Limitations'];
    const headings: HeadingNode[] = labels.map((text, order) => ({ id: `h${order}`, type: "heading", level: 1, order, text }));
    const outline = buildHeadingOutline(headings);
    expect(outline.map(h => h.sectionNumber)).toEqual(['I','II','III','A','1','2','B','IV','4.1']);
    expect(outline.map(h => h.displayLevel)).toEqual([1,1,1,2,3,3,2,1,2]);
    expect(outline[0].label).toBe('INTRODUCTION');
    expect(outline[1].label).toBe('RELATED WORKS');
    expect(buildHeadingOutline([{...headings[4], explicitHierarchy:true, level:2}])[0].displayLevel).toBe(2);
  });
  it("groups contiguous source lists while retaining IDs and explicit markers, and keeps references singly numbered", () => {
    const paper: PaperDocument = {...demoPaper, metadata:{title:'Reader specimen',authors:[]}, references:['[7] First reference','12. Second reference'], sections:[
      {id:'title',type:'heading',role:'title',level:1,text:'Reader specimen',order:0},
      {id:'section',type:'heading',level:1,text:'1. Results',order:1},
      {id:'item1',type:'list_item',text:'**First**',marker:'(a)',listId:'one',order:2},
      {id:'item2',type:'list_item',text:'Second',marker:'(b)',listId:'one',order:3},
      {id:'list1',type:'list',ordered:true,items:['Third'],order:4},
      {id:'list2',type:'list',ordered:true,items:['Fourth'],order:5},
    ]};
    const {container}=render(<PaperReader paper={paper}/>);
    expect(container.querySelectorAll('.paper-source-list')).toHaveLength(1);
    expect(container.querySelectorAll('.paper-source-list>li')).toHaveLength(2);
    expect(container.querySelector('#item1 .paper-list-marker')).toHaveTextContent('(a)');
    expect(container.querySelector('#item2')).toHaveAttribute('data-list-id','one');
    expect(container.querySelectorAll('ol.paper-list')).toHaveLength(1);
    expect(container.querySelectorAll('ol.paper-list>li')).toHaveLength(2);
    expect(container.querySelector('#list2')).not.toBeNull();
    expect(container.querySelector('a[href="#title"]')).toBeNull();
    expect(container.querySelectorAll('.paper-reference-number')[0]).toHaveTextContent('[7]');
    expect(container.querySelectorAll('.paper-reference-number')[1]).toHaveTextContent('12.');
    expect(container.querySelector('.paper-reference-list li div')).toHaveTextContent(/^First reference$/);
  });
});

it("preserves whitespace around formatted inline fragments", () => {
  const { container } = render(<p>Start<PaperMarkdown text=" **bold** " inline />end</p>);
  expect(container.textContent).toBe("Start bold end");
  cleanup();
});
it("gives Markdown footnotes a separate namespace for each source block", () => {
  const text='A note[^1].\n\n[^1]: Footnote text.';
  const { container }=render(<><PaperMarkdown text={text} idPrefix="first"/><PaperMarkdown text={text} idPrefix="second"/></>);
  const ids=[...container.querySelectorAll('[id]')].map(el=>el.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const link of container.querySelectorAll('a[href^="#"]')) expect(container.querySelector(link.getAttribute('href')!)).not.toBeNull();
  for (const ref of container.querySelectorAll('[aria-describedby]')) expect(container.querySelector(`#${ref.getAttribute('aria-describedby')}`)).not.toBeNull();
  expect(container.querySelector('a[href="#first-fn-1"]')).not.toBeNull();
  expect(container.querySelector('a[href="#second-fn-1"]')).not.toBeNull();
  cleanup();
});
