/**
 * Type declarations for foliate-js modules
 */

declare module 'foliate-js/view.js' {
    export function makeBook(file: File | Blob): Promise<any>;
}

declare module 'foliate-js/paginator.js' {
    export class Paginator extends HTMLElement {
        setAttribute(name: string, value: string): void;
        removeAttribute(name: string): void;
        open(book: any): void;
        goTo(destination: any): void;
        next(): void;
        prev(): void;
        scrollBy(x: number, y: number, options?: ScrollToOptions): void;
        snap(x: number, y: number): void;
        readonly heads: HTMLElement[];
        readonly feet: HTMLElement[];
        setStyles(styles: string[]): void;
    }
}

declare module 'foliate-js/overlayer.js' {
    export class Overlayer {
        static highlight: any;
        static underline: any;
        static squiggly: any;
        static strikethrough: any;
    }
}

declare module 'foliate-js/search.js' {
    export class Search {
        search(doc: Document, query: string): any[];
    }
}
