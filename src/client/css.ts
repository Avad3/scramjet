const cssProperties = ["background", "background-image", "mask", "mask-image", "list-style", "list-style-image", "border-image", "border-image-source", "cursor"];
const jsProperties = ["background", "backgroundImage", "mask", "maskImage", "listStyle", "listStyleImage", "borderImage", "borderImageSource", "cursor"];

    
CSSStyleDeclaration.prototype.setProperty = new Proxy(CSSStyleDeclaration.prototype.setProperty, {
  apply(target, thisArg, argArray) {
    if (cssProperties.includes(argArray[0])) argArray[1] = self.__scramjet$bundle.rewriters.rewriteCss(argArray[1]);
    
    return Reflect.apply(target, thisArg, argArray);  
  },
});

jsProperties.forEach((prop) => {
  const propDescriptor = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, prop);

  Object.defineProperty(CSSStyleDeclaration.prototype, prop, {
    set(v) {
        propDescriptor.set.call(this, self.__scramjet$bundle.rewriters.rewriteCss(v));
    },
  })
});
